import { VapiClient } from "@vapi-ai/server-sdk";
import {
  runInteractiveLlmTurn,
  startInteractiveLlmCall,
  voiceCallId,
} from "../agent/llmCallOrchestrator.js";
import { agentConfig } from "../config/agent.config.js";
import { ApiError, isDuplicate } from "../http/errors.js";
import type { vapiCompletionBody, vapiWebhookBody } from "../http/validation.js";
import { callIsComplete, endCall, getCall, persistCall } from "../services/calls.js";
import { getLeadContext } from "../tools/getLeadContext.js";
import { assertContactAllowed } from "../services/leads.js";
import type { Lead } from "../types.js";
import type { z } from "zod";

const vapiAssistantPrompt =
  "You are Carla, an AI SDR. Follow the backend-provided conversation instructions and use the configured tools. Keep responses concise, natural, and professional.";

let outboundCallsCreated = 0;

const envFlag = (value: string | undefined) => value?.toLowerCase() === "true";

const envNumber = (name: string, fallback: number, max: number) => {
  const parsed = Number(process.env[name] ?? fallback);

  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const requireVapiApiKey = () => {
  const apiKey = process.env.VAPI_API_KEY;

  if (!apiKey || apiKey === "replace_me") {
    throw new ApiError(503, "VAPI_NOT_CONFIGURED", "VAPI_API_KEY is required for Vapi voice calls.");
  }

  return apiKey;
};

const publicBaseUrl = () =>
  (process.env.VAPI_PUBLIC_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

const maxOutboundCalls = () => envNumber("VAPI_MAX_OUTBOUND_CALLS", 2, 10);

const maxCallDurationSeconds = () => envNumber("VAPI_MAX_CALL_DURATION_SECONDS", 300, 900);

const canPlaceOutboundCall = () => envFlag(process.env.VAPI_ALLOW_OUTBOUND_CALLS);

type StartVapiVoiceCallInput = {
  leadId: string;
  customerNumber?: string;
};

type VapiCustomLlmBody = z.infer<typeof vapiCompletionBody>;
type VapiCustomLlmMessage = NonNullable<VapiCustomLlmBody["messages"]>[number];

export const getVapiConfig = () => ({
  enabled: Boolean(process.env.VAPI_API_KEY && process.env.VAPI_API_KEY !== "replace_me"),
  allowOutboundCalls: canPlaceOutboundCall(),
  maxOutboundCalls: maxOutboundCalls(),
  outboundCallsCreated,
  maxCallDurationSeconds: maxCallDurationSeconds(),
  publicBaseUrl: publicBaseUrl(),
  assistantPrompt: vapiAssistantPrompt,
  voiceLayerOnly: true,
});

export const startVapiVoiceCall = async ({
  leadId,
  customerNumber,
}: StartVapiVoiceCallInput) => {
  const lead = await getLeadContext(leadId);
  assertContactAllowed(lead);
  const outbound = canPlaceOutboundCall();
  if (outbound && (!lead.phoneNumber || (customerNumber && customerNumber !== lead.phoneNumber))) {
    throw new ApiError(400, "CUSTOMER_MISMATCH", "A CRM phone number is required and must match any provided customer number.");
  }
  const number = outbound ? lead.phoneNumber : (customerNumber ?? lead.phoneNumber);
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const assistantId = process.env.VAPI_ASSISTANT_ID || undefined;
  const plannedCall = {
    name: `Carla voice call - ${lead.name}`,
    phoneNumberId: phoneNumberId && phoneNumberId !== "replace_me" ? phoneNumberId : undefined,
    customer: number
      ? {
          number,
          name: lead.name,
        }
      : undefined,
    assistantId,
    assistantOverrides: assistantId
      ? {
          maxDurationSeconds: maxCallDurationSeconds(),
          ...(process.env.VAPI_PUBLIC_BASE_URL ? { server: {
            url: `${publicBaseUrl()}/api/vapi/webhook`,
            credentialId: process.env.VAPI_SERVER_CREDENTIAL_ID || undefined,
          } } : {}),
        }
      : undefined,
    metadata: {
      leadId: lead.id,
      source: "ai-sdr",
      backendBrain: true,
      voiceLayerOnly: true,
    },
  };

  if (!outbound) {
    return {
      status: "dry_run",
      reason:
        "VAPI_ALLOW_OUTBOUND_CALLS is not true. No paid Vapi call was created.",
      lead,
      plannedCall,
    };
  }

  requireVapiApiKey();

  if (outboundCallsCreated >= maxOutboundCalls()) {
    throw new ApiError(429, "VAPI_BUDGET_REACHED", "The Vapi outbound call budget has been reached.");
  }

  if (!plannedCall.phoneNumberId) {
    throw new ApiError(503, "VAPI_NOT_CONFIGURED", "VAPI_PHONE_NUMBER_ID is required when outbound calls are enabled.");
  }

  if (!plannedCall.assistantId) {
    throw new ApiError(503, "VAPI_NOT_CONFIGURED", "VAPI_ASSISTANT_ID is required when outbound calls are enabled.");
  }

  const vapi = new VapiClient({ token: requireVapiApiKey() });
  outboundCallsCreated += 1;
  let call;
  try {
    call = await vapi.calls.create(plannedCall);
  } catch {
    throw new ApiError(502, "VAPI_REQUEST_FAILED", "Vapi could not confirm the outbound request.");
  }
  if (!("id" in call) || typeof call.id !== "string") {
    throw new ApiError(502, "VAPI_REQUEST_FAILED", "Vapi did not return a single call ID.");
  }
  await recordOutboundCall(voiceCallId(call.id), lead);

  return {
    status: "created",
    lead,
    call,
    budget: {
      outboundCallsCreated,
      maxOutboundCalls: maxOutboundCalls(),
      maxCallDurationSeconds: maxCallDurationSeconds(),
    },
  };
};

async function recordOutboundCall(callId: string, lead: Lead) {
  const nextAction = "Wait for the voice call to connect.";
  try {
    await persistCall({
      callId, lead, mode: "llm", agent: agentConfig, transcript: [], toolCalls: [],
      statusEvents: [{ status: "idle", label: "Waiting for voice connection" }],
      summary: { leadId: lead.id, leadName: lead.name, company: lead.company, painPoints: [], objections: [],
        interestLevel: "low", meetingStatus: "not_booked", recommendedNextAction: nextAction, shortSummaryForSales: "Voice call initiated." },
      classification: { outcome: "needs_human_follow_up", recommendedNextAction: nextAction, reason: "The voice call has not started." },
    }, { kind: "vapi", createOnly: true });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const { metadata } = await getCall(callId);
    if (metadata.kind !== "vapi" || metadata.leadId !== lead.id) throw error;
  }
}

export const handleVapiWebhook = async ({ message }: z.infer<typeof vapiWebhookBody>) => {
  if (message.type === "end-of-call-report" && message.call?.id) {
    const callId = voiceCallId(message.call.id);
    try {
      const { metadata } = await getCall(callId);
      if (metadata.kind === "vapi" && metadata.status === "active") await endCall(callId, metadata.leadId, "vapi");
    } catch (error) {
      if (!(error instanceof ApiError && ["CALL_NOT_FOUND", "CALL_ENDED"].includes(error.code))) throw error;
    }
  }
  return {
    received: true,
    messageType: message?.type ?? "unknown",
    note:
      "Vapi webhook received. Configure Vapi Custom LLM to POST /api/vapi/chat/completions so Carla's backend remains the agent brain.",
  };
};

export const handleVapiCustomLlmCompletion = async (parsedBody: VapiCustomLlmBody) => {
  if (!parsedBody.call?.id) {
    throw new ApiError(400, "PROVIDER_CALL_REQUIRED", "A confirmed Vapi call ID is required.");
  }
  const leadId =
    parsedBody.call?.metadata?.leadId ??
    parsedBody.metadata?.leadId ??
    parsedBody.call?.assistantOverrides?.metadata?.leadId ??
    parsedBody.call?.assistantOverrides?.variableValues?.leadId ??
    parsedBody.assistantOverrides?.metadata?.leadId ??
    parsedBody.assistantOverrides?.variableValues?.leadId ??
    parsedBody.call?.variableValues?.leadId;

  if (!leadId) {
    throw new ApiError(400, "LEAD_REQUIRED",
      "Vapi Custom LLM requests must include call.metadata.leadId or metadata.leadId.",
    );
  }

  const lead = await getLeadContext(leadId);
  const messages = parsedBody.messages ?? [];
  const userMessageIndex = messages.findLastIndex((message) => message.role === "user");
  const latestLeadReply =
    userMessageIndex >= 0 ? messageContentToText(messages[userMessageIndex]) : "";
  const prior = await startInteractiveLlmCall(leadId, { providerCallId: parsedBody.call?.id });
  const lastLeadReply = [...prior.transcript].reverse().find((entry) => entry.speaker === "lead")?.message;
  const call = latestLeadReply && latestLeadReply !== lastLeadReply && !callIsComplete(prior)
    ? await runInteractiveLlmTurn({
        callId: prior.callId,
        leadId,
        leadReply: latestLeadReply.slice(0, 4000),
        kind: "vapi",
      })
    : prior;
  const reply =
    [...call.transcript].reverse().find((entry) => entry.speaker === "agent")?.message ??
    "Thanks. I will have the sales team follow up with the next best step.";

  return {
    id: `carla-${call.callId}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "carla-backend",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: reply,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    metadata: {
      callId: call.callId,
      leadId: lead.id,
      outcome: call.classification.outcome,
      meetingStatus: call.summary.meetingStatus,
      callStatus: callIsComplete(call) ? "completed" : "active",
      backendBrain: true,
      voiceLayerOnly: true,
    },
  };
};

const messageContentToText = (message: VapiCustomLlmMessage) => {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  return (
    message.content
      ?.map((part) => part.text ?? "")
      .join(" ")
      .trim() ?? ""
  );
};
