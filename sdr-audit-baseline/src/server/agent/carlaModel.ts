import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ApiError } from "../http/errors.js";
import type { AgentAnalysis, CallTranscriptEntry } from "../types.js";
import { carlaSystemPrompt } from "./carlaSystemPrompt.js";
import { intents, nextMoves, objections } from "./carlaPolicy.js";
import { agentLogId, executeCarlaTool, factSchema, toolDefinitions } from "./carlaTools.js";
import type { ToolContext } from "./carlaTools.js";

const turnSchema = z.strictObject({
  reply: z.string().min(1).max(550),
  intent: z.enum(intents),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  objectionType: z.enum(objections),
  nextAgentMove: z.enum(nextMoves),
  reason: z.string().min(1).max(240),
  facts: z.array(factSchema).max(5),
  sourceId: z.string().max(140).nullable(),
  sourceQuote: z.string().max(280).nullable(),
});
export type ModelTurn = z.infer<typeof turnSchema>;
type Usage = AgentAnalysis["modelUsage"];
export const emptyUsage = (): Usage => ({ requests: 0, inputTokens: 0, outputTokens: 0 });

export class ModelTurnError extends ApiError {
  readonly usage: Usage;

  constructor(error: ApiError, usage: Usage) {
    super(error.status, error.code, error.message);
    this.usage = usage;
  }
}

export function configuredInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum ? Math.min(maximum, value) : fallback;
}

export function createModelClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "replace_me") {
    throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "Set OPENAI_API_KEY to enable AI calls. Predefined calls are available without a key.");
  }
  return new OpenAI({ apiKey, timeout: 9000, maxRetries: 0 });
}

function boundedHistory(transcript: CallTranscriptEntry[]) {
  const recent: Array<Pick<CallTranscriptEntry, "speaker" | "message">> = [];
  let remaining = 8200;
  for (const { speaker, message } of transcript.slice(-14).reverse()) {
    const excerpt = message.slice(0, 2200);
    remaining -= Buffer.byteLength(excerpt);
    if (remaining < 0) break;
    recent.unshift({ speaker, message: excerpt });
  }
  return recent;
}

function scopedContext(ctx: ToolContext, transcript: CallTranscriptEntry[]) {
  const { name, title, company, industry, companySize, currentTools, discussionTopic, previousInteraction } = ctx.lead;
  return {
    opening: transcript.length === 0,
    lead: { name, title, company, industry, companySize, currentTools: currentTools.slice(0, 10),
      discussionTopic: discussionTopic.slice(0, 500), previousInteraction: previousInteraction.slice(0, 500) },
    knownFacts: ctx.knownFacts.slice(-12),
    transcript: boundedHistory(transcript),
    latestLeadMessage: ctx.latestReply.slice(0, 3000),
    hasPreviouslyOfferedOptions: ctx.previousOptions.length > 0,
    approvedSources: ctx.sources,
    finalTurn: ctx.atLimit,
  };
}

const format = zodResponseFormat(turnSchema, "carla_turn");

export async function generateModelTurn(
  client: OpenAI, ctx: ToolContext, transcript: CallTranscriptEntry[], previousUsage: Usage,
): Promise<{ turn?: ModelTurn; usage: Usage }> {
  const usage = { ...previousUsage };
  const maxTokens = configuredInteger("MAX_OUTPUT_TOKENS", 500, 180, 800);
  const maxSteps = configuredInteger("AGENT_MAX_MODEL_STEPS", 4, 1, 6);
  const maxCallTokens = configuredInteger("AGENT_MAX_CALL_TOKENS", 90_000, 1000, 250_000);
  const timeout = configuredInteger("AGENT_TURN_TIMEOUT_MS", 20_000, 250, 60_000);
  const signal = AbortSignal.timeout(timeout);
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: carlaSystemPrompt },
    { role: "user", content: JSON.stringify(scopedContext(ctx, transcript)) },
  ];
  try {
    for (let step = 0; step < maxSteps; step++) {
      const last = step === maxSteps - 1;
      const request = {
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini", messages, response_format: format,
        max_completion_tokens: maxTokens, store: false,
        ...(last ? {} : { tools: toolDefinitions, parallel_tool_calls: false }),
      };
      // Byte length is a conservative estimate for the next request. Use provider usage for completed requests.
      const estimate = Buffer.byteLength(JSON.stringify(request)) + 128;
      if (usage.inputTokens + usage.outputTokens + estimate + maxTokens > maxCallTokens) return { usage };
      usage.requests++;
      usage.inputTokens += estimate;
      usage.outputTokens += maxTokens;
      const response = await client.chat.completions.create(request, { signal });
      if (response.usage) {
        usage.inputTokens += response.usage.prompt_tokens - estimate;
        usage.outputTokens += response.usage.completion_tokens - maxTokens;
      }
      const choice = response.choices[0];
      const message = choice?.message;
      if (!message || message.refusal) throw new ApiError(502, "INVALID_MODEL_RESPONSE", "Carla could not prepare a response. Try again.");
      const calls = message.tool_calls;
      if (calls?.length) {
        if (last || calls.length !== 1 || calls[0].type !== "function") {
          throw new ApiError(502, "INVALID_MODEL_RESPONSE", "Carla returned an unsupported tool request. Try again.");
        }
        const call = calls[0];
        const output = await executeCarlaTool(call.function.name, call.function.arguments, ctx);
        messages.push({ role: "assistant", content: message.content, tool_calls: calls });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
        continue;
      }
      if (choice.finish_reason === "length") throw new ApiError(502, "MODEL_OUTPUT_LIMIT", "Carla reached the reply limit. Try a shorter reply.");
      return { turn: turnSchema.parse(JSON.parse(message.content ?? "")), usage };
    }
  } catch (error) {
    const failure = error instanceof ApiError ? error :
      signal.aborted || error instanceof OpenAI.APIConnectionTimeoutError
        ? new ApiError(504, "AGENT_TIMEOUT", "Carla took too long to respond. Retry or use Predefined mode.")
        : error instanceof SyntaxError || error instanceof z.ZodError
          ? new ApiError(502, "INVALID_MODEL_RESPONSE", "Carla returned an invalid response. Try again.")
          : new ApiError(502, "MODEL_UNAVAILABLE", "Carla could not reach the AI service. Retry or use Predefined mode.");
    console.warn(JSON.stringify({ event: "carla_model_error", trace: agentLogId(ctx.callId), code: failure.code }));
    throw new ModelTurnError(failure, usage);
  }
  return { usage };
}
