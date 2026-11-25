import { randomUUID } from "node:crypto";
import { ApiError, isDuplicate } from "../http/errors.js";
import { callIsComplete, getCall, persistCall, storeFailedTurnUsage, withCallTurn } from "../services/calls.js";
import { assertContactAllowed, getLead } from "../services/leads.js";
import type { CallResult, Lead } from "../types.js";
import { configuredInteger, createModelClient, ModelTurnError } from "./carlaModel.js";
import { advanceCarla } from "./carlaTurn.js";

const newCallId = () => "call_" + randomUUID();

export function voiceCallId(providerId: string) {
  return providerId.startsWith("vapi_") || providerId.startsWith("call_") ? providerId : "vapi_" + providerId;
}

export async function startInteractiveLlmCall(leadId: string, voice?: { providerCallId?: string }): Promise<CallResult> {
  const startedAt = new Date();
  const lead = await getLead(leadId);
  const callId = voice?.providerCallId ? voiceCallId(voice.providerCallId) : newCallId();
  if (voice?.providerCallId) {
    try {
      const { call, metadata } = await getCall(callId);
      if (metadata.kind !== "vapi" || metadata.leadId !== lead.id) {
        throw new ApiError(409, "CALL_MISMATCH", "The provider call does not match this lead.");
      }
      if (call.transcript.length || callIsComplete(call)) return call;
      assertContactAllowed(lead);
      return await withCallTurn(callId, leadId, async (turnToken) => {
        const { call: current } = await getCall(callId);
        if (current.transcript.length) return current;
        const { result } = await advanceCarla({ callId, lead, prior: current });
        return persistCall(result, { kind: "vapi", turnToken });
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "CALL_NOT_FOUND")) throw error;
    }
  }

  assertContactAllowed(lead);
  const { result } = await advanceCarla({ callId, lead });
  try {
    return await persistCall(result, { kind: voice ? "vapi" : "interactive", startedAt, createOnly: true });
  } catch (error) {
    if (voice?.providerCallId && isDuplicate(error)) {
      const { call, metadata } = await getCall(callId);
      if (metadata.kind === "vapi" && metadata.leadId === leadId) return call;
      throw new ApiError(409, "CALL_MISMATCH", "The provider call does not match this lead.");
    }
    throw error;
  }
}

export async function runInteractiveLlmTurn({
  callId, leadId, leadReply, expectedMessageCount, kind = "interactive",
}: {
  callId?: string; leadId: string; leadReply: string; expectedMessageCount?: number; kind?: "interactive" | "vapi";
}) {
  const id = callId ?? (await startInteractiveLlmCall(leadId)).callId;
  const lead = await getLead(leadId);
  assertContactAllowed(lead);
  return withCallTurn(id, leadId, async (turnToken) => {
    const { call: prior, metadata, offeredSlotIds } = await getCall(id);
    if (metadata.kind !== kind) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found for this transport.");
    if (callId && expectedMessageCount !== undefined && prior.transcript.length !== expectedMessageCount) {
      throw new ApiError(409, "STALE_TRANSCRIPT", "This call has advanced. Reload the call before submitting another reply.");
    }
    const leadTurnCount = prior.transcript.filter(({ speaker }) => speaker === "lead").length + 1;
    const { result, meeting, newFacts, optedOut, offeredSlotIds: options } = await advanceCarla({
      callId: id, lead, prior, previousOptions: offeredSlotIds, latestReply: leadReply,
      atLimit: leadTurnCount >= configuredInteger("MAX_INTERACTIVE_LEAD_TURNS", 6, 1, 12),
    }).catch(async (error: unknown) => {
      if (error instanceof ModelTurnError) await storeFailedTurnUsage(id, turnToken, error.usage);
      throw error;
    });
    return persistCall(result, { kind, offeredSlotIds: options, meeting, newFacts, optedOut, turnToken });
  });
}

export async function runLlmCall(leadId: string): Promise<CallResult> {
  const startedAt = new Date();
  const lead = await getLead(leadId);
  assertContactAllowed(lead);
  const client = createModelClient();
  const callId = newCallId();
  const replies = scriptedReplies(lead).slice(0, configuredInteger("MAX_CALL_TURNS", 8, 1, 12));
  let turn = await advanceCarla({ client, callId, lead });
  const toolCalls = [...turn.result.toolCalls];
  const events = [...turn.result.statusEvents.slice(0, -1)];
  for (const [index, reply] of replies.entries()) {
    if (callIsComplete(turn.result)) break;
    turn = await advanceCarla({ client, callId, lead, prior: turn.result, previousOptions: turn.offeredSlotIds,
      latestReply: reply, atLimit: index === replies.length - 1 });
    toolCalls.push(...turn.result.toolCalls);
    events.push(...turn.result.statusEvents.slice(0, -1));
  }
  turn.result.toolCalls = toolCalls;
  turn.result.statusEvents = [...events, { status: "idle", label: "Call ended" }];
  // Scripted replies are evaluation data. Only live lead replies update the CRM.
  return persistCall(turn.result, { kind: "demo", startedAt, createOnly: true, meeting: turn.meeting });
}

function scriptedReplies(lead: Lead): string[] {
  switch (lead.scenario) {
    case "interested":
      return ["Yes, outbound follow-up is taking too much time.", "Our reps duplicate follow-ups across our sales tools.",
        "Can we book a meeting to discuss our workflow?", "Option 1 works"];
    case "busy":
      return ["I am about to join a meeting. Can you call me later?"];
    case "not_interested":
      return ["No thanks, I'm not interested."];
    case "budget_objection":
      return ["Budget is tight, but our team spends hours on repetitive follow-up.", "Can you email me a brief overview?"];
    case "send_email":
      return ["Can you send me an email instead?"];
    case "existing_crm":
      return ["We already have a CRM and don't want to replace it.", "Please email me a brief outline."];
    case "authority_objection":
      return ["Our CRO would need to approve anything like this.", "Please send me an email I can forward."];
    case "security_concern":
      return ["This sounds relevant, but what security features are verified?", "Please send me details by email."];
  }
}
