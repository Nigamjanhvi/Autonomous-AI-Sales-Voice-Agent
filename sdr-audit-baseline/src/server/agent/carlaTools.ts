import { createHash } from "node:crypto";
import { zodFunction } from "openai/helpers/zod";
import { z } from "zod";
import { ApiError } from "../http/errors.js";
import { getBookableMeeting, listAvailability } from "../services/appointments.js";
import { searchKnowledge } from "../services/knowledge.js";
import type { KnowledgeSource } from "../services/knowledge.js";
import type { CalendarSlot, CallToolCall, Lead, Meeting, SalesFact } from "../types.js";
import { acceptedOption, disposition, factKinds, mergeFacts, qualify, verifiedFact, wantsScheduling } from "./carlaPolicy.js";

export const factSchema = z.strictObject({ kind: z.enum(factKinds), evidence: z.string().min(3).max(220) });
const factsSchema = z.strictObject({ facts: z.array(factSchema).min(1).max(5) });
type CloseReason = "declined" | "callback" | "email" | "complete";
export type ToolContext = {
  callId: string;
  lead: Lead;
  latestReply: string;
  previousOptions: string[];
  atLimit: boolean;
  finishing?: boolean;
  knownFacts: SalesFact[];
  newFacts: SalesFact[];
  slots?: CalendarSlot[];
  booking?: Meeting;
  bookingError?: ApiError;
  sources: KnowledgeSource[];
  close?: CloseReason;
  events: CallToolCall[];
};

function tool<S extends z.ZodType>(name: string, description: string, schema: S,
  execute: (args: z.infer<S>, context: ToolContext) => unknown | Promise<unknown>) {
  return {
    name,
    definition: zodFunction({ name, description, parameters: schema }),
    invoke: (json: unknown, context: ToolContext) => execute(schema.parse(json), context),
  };
}

const empty = z.strictObject({});
const tools = [
  tool("getLeadDetails", "Read scoped CRM and discovery context for the current lead.", empty, (_args, ctx) => {
    const { name, title, company, industry, companySize, currentTools, discussionTopic, previousInteraction } = ctx.lead;
    return { name, title, company, industry, companySize, currentTools, discussionTopic, previousInteraction,
      facts: mergeFacts(ctx.knownFacts, ctx.newFacts) };
  }),
  tool("updateLead", "Record exact discovery excerpts explicitly stated by the lead in their latest reply.", factsSchema, ({ facts }, ctx) => {
    const verified = facts.flatMap((fact) => {
      const accepted = verifiedFact(fact, ctx.latestReply);
      return accepted ? [accepted] : [];
    });
    if (!verified.length) throw new ApiError(422, "EVIDENCE_REQUIRED", "No proposed evidence could be verified.");
    const alreadyKnown = new Set(ctx.knownFacts.map((fact) => fact.kind + ":" + fact.evidence.toLowerCase()));
    ctx.newFacts = mergeFacts(ctx.newFacts, verified.filter((fact) => !alreadyKnown.has(fact.kind + ":" + fact.evidence.toLowerCase())));
    return { verified: verified.map(({ kind }) => kind), status: "staged" };
  }),
  tool("searchKnowledgeBase", "Retrieve approved company passages for a product, pricing, or integration question.",
    z.strictObject({ query: z.string().min(3).max(350) }), async ({ query }, ctx) => {
      const sources = await searchKnowledge(query);
      ctx.sources = [...new Map([...ctx.sources, ...sources].map((source) => [source.sourceId, source])).values()].slice(-6);
      return { sources };
    }),
  tool("getAvailableSlots", "Offer live calendar options after an explicit scheduling request.",
    z.strictObject({ preferredDate: z.iso.date().nullable() }), async ({ preferredDate }, ctx) => {
      if (ctx.atLimit || !wantsScheduling(ctx.latestReply)) throw new ApiError(409, "SCHEDULING_NOT_REQUESTED", "Scheduling is not available for this turn.");
      if (preferredDate && !ctx.latestReply.includes(preferredDate)) {
        throw new ApiError(422, "DATE_NOT_CONFIRMED", "The preferred date is absent from the latest reply.");
      }
      ctx.slots ??= (await listAvailability(preferredDate ?? undefined)).slice(0, 2);
      return ctx.slots;
    }),
  tool("bookAppointment", "Stage the exact previously offered option clearly accepted in the latest lead reply.",
    z.strictObject({ option: z.union([z.literal(1), z.literal(2)]) }), async ({ option }, ctx) => {
      if (option !== acceptedOption(ctx.latestReply, ctx.previousOptions)) {
        throw new ApiError(409, "CONFIRMATION_REQUIRED", "The lead has not accepted this offered option.");
      }
      if (ctx.bookingError) throw ctx.bookingError;
      try {
        ctx.booking ??= await getBookableMeeting(ctx.lead.id, ctx.previousOptions[option - 1], "The lead explicitly accepted this offered slot.");
      } catch (error) {
        if (error instanceof ApiError) ctx.bookingError = error;
        throw error;
      }
      return { status: "pending_commit", option, startsAt: ctx.booking.startsAt, salesRep: ctx.booking.salesRep };
    }),
  tool("classifyLead", "Compute the application’s qualification score from verified facts.", empty, (_args, ctx) => {
    const reason = disposition(ctx.latestReply);
    return qualify(mergeFacts(ctx.knownFacts, ctx.newFacts), Boolean(ctx.booking), reason === "declined" || reason === "opt_out");
  }),
  tool("saveCallSummary", "Queue the backend-generated summary when closing the active call.", empty, (_args, ctx) => {
    if (!ctx.finishing && !ctx.booking && !ctx.close && !ctx.atLimit && !disposition(ctx.latestReply)) {
      throw new ApiError(409, "CALL_ACTIVE", "The conversation is still active.");
    }
    return { status: "pending_commit" };
  }),
  tool("endCall", "Request a polite close authorized by the lead’s reply or the application’s turn limit.",
    z.strictObject({ reason: z.enum(["declined", "callback", "email", "complete"]) }), ({ reason }, ctx) => {
      const observed = disposition(ctx.latestReply);
      if (!(reason === observed || (reason === "declined" && observed === "opt_out") ||
          (reason === "complete" && (ctx.booking || ctx.atLimit)))) {
        throw new ApiError(409, "CLOSE_NOT_CONFIRMED", "The current conversation does not support that close.");
      }
      ctx.close = reason;
      return { status: "pending_commit" };
    }),
];

export const toolDefinitions = tools.map(({ definition }) => definition);
export const agentLogId = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 16);

export async function executeCarlaTool(name: string, args: string, ctx: ToolContext): Promise<unknown> {
  const started = Date.now();
  const handler = tools.find((entry) => entry.name === name);
  const safeName = handler?.name ?? "unknown";
  let result: unknown;
  let stored: unknown;
  let code = "OK";
  try {
    if (!handler) throw new ApiError(400, "UNKNOWN_TOOL", "This tool is unavailable.");
    result = await handler.invoke(JSON.parse(args), ctx);
    if (name === "searchKnowledgeBase") stored = { sourceIds: ctx.sources.map(({ sourceId }) => sourceId) };
    else if (name === "getLeadDetails") stored = { leadId: ctx.lead.id };
    else if (name === "classifyLead") {
      const classification = result as ReturnType<typeof qualify>;
      stored = { score: classification.score, status: classification.status };
    } else if (name === "bookAppointment") stored = ctx.booking;
    else stored = result;
  } catch (error) {
    code = error instanceof ApiError ? error.code : error instanceof SyntaxError || error instanceof z.ZodError
      ? "INVALID_TOOL_ARGUMENTS" : "TOOL_FAILED";
    result = stored = { error: code };
  }
  ctx.events.push({ name: safeName, input: {}, output: stored });
  console.info(JSON.stringify({ event: "carla_tool", trace: agentLogId(ctx.callId), tool: safeName, code, durationMs: Date.now() - started }));
  return result;
}
