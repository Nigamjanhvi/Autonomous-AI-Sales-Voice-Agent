import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { AppointmentModel, CallModel, ConversationModel, SummaryModel } from "../db/models.js";
import type { CallDocument, CallKind, CallState } from "../db/models.js";
import { ApiError } from "../http/errors.js";
import { classifyLeadOutcome } from "../tools/classifyLeadOutcome.js";
import type { AgentMode, CallResult, CallSummary, LeadOutcome, Meeting } from "../types.js";
import { getLead, pageInfo } from "./leads.js";
import type { PageInput } from "./leads.js";
import { reserveAppointment } from "./appointments.js";

const summariesPath = (id: string) => `/api/call-summaries/${id}`;
const callSummaryId = (callId: string) => `summary_${callId}`;
type CallFilters = PageInput & { leadId?: string; mode?: AgentMode; outcome?: LeadOutcome; kind?: CallKind; status?: CallState };
type PersistOptions = { kind: CallKind; offeredSlotIds?: string[] } &
  ({ createOnly: true; startedAt?: Date } | { turnToken: string });

export function callIsComplete(call: CallResult) {
  return call.statusEvents.at(-1)?.label === "Call ended";
}

export async function persistCall(result: CallResult, options: PersistOptions) {
  const { callId, lead, agent, mode, statusEvents, transcript, summary, classification, intentDetections } = result;
  const complete = callIsComplete(result);
  const summaryId = callSummaryId(callId);
  const toolCalls = result.toolCalls.filter((tool) => tool.name !== "saveCallSummary");
  if (complete) toolCalls.push({ name: "saveCallSummary", input: { summary }, output: { id: summaryId, path: summariesPath(summaryId) } });
  const meeting = toolCalls.find((tool) => tool.name === "bookMeeting")?.output as Meeting | undefined;
  if ((summary.meetingStatus === "booked") !== Boolean(meeting) ||
      (meeting && (!complete || meeting.leadId !== lead.id || meeting.slotId !== summary.bookedSlotId))) {
    throw new Error("Booking does not match the call.");
  }
  await mongoose.connection.transaction(async (session) => {
    const fields = {
      callId, leadId: lead.id, lead, agent, mode, kind: options.kind, status: complete ? "completed" : "active",
      outcome: classification.outcome, statusEvents, toolCalls, intentDetections,
      offeredSlotIds: options.offeredSlotIds ?? [], ...(complete ? { endedAt: new Date() } : {}),
    };
    if ("createOnly" in options) {
      await new CallModel({ ...fields, startedAt: options.startedAt ?? new Date() }).save({ session });
    } else {
      const update = await CallModel.updateOne({ callId, leadId: lead.id, turnToken: options.turnToken },
        { $set: fields }, { runValidators: true, session });
      if (!update.matchedCount) throw new ApiError(409, "CALL_BUSY", "This call turn is no longer current.");
    }
    if (meeting) await reserveAppointment(lead.id, meeting.slotId, meeting.notes, session, callId);
    await ConversationModel.updateOne({ callId }, { $set: { leadId: lead.id, messages: transcript } }, { upsert: true, runValidators: true, session });
    await SummaryModel.updateOne({ callId }, { $set: { id: summaryId, leadId: lead.id, summary, classification } },
      { upsert: true, runValidators: true, session });
  });
  result.toolCalls = toolCalls;
  return result;
}

export async function getCall(callId: string) {
  return mongoose.connection.transaction(async (session) => {
    const row = await CallModel.findOne({ callId }).session(session).lean<CallDocument>();
    if (!row) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found.");
    const conversation = await ConversationModel.findOne({ callId }).session(session).lean<{ messages: CallResult["transcript"] }>();
    const summary = await SummaryModel.findOne({ callId }).session(session).lean();
    if (!conversation || !summary) throw new Error("Call records are incomplete.");
    const call: CallResult = {
      callId, mode: row.mode, agent: row.agent, lead: row.lead, statusEvents: row.statusEvents,
      transcript: conversation.messages, toolCalls: row.toolCalls, intentDetections: row.intentDetections,
      summary: summary.summary, classification: summary.classification,
    };
    return { call, metadata: publicMetadata(row), offeredSlotIds: row.offeredSlotIds };
  }, { readConcern: { level: "snapshot" } });
}

function publicMetadata(row: CallDocument) {
  return { callId: row.callId, leadId: row.leadId, kind: row.kind, mode: row.mode, status: row.status,
    outcome: row.outcome, startedAt: row.startedAt, endedAt: row.endedAt };
}

export async function listCalls({ page, limit, ...filters }: CallFilters) {
  const filter = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
  const pagination = pageInfo({ page, limit }, await CallModel.countDocuments(filter));
  const calls = await CallModel.find(filter).sort({ startedAt: -1, callId: 1 })
    .skip((pagination.page - 1) * pagination.limit).limit(pagination.limit).lean<CallDocument[]>();
  return { calls: calls.map(publicMetadata), pagination };
}

export async function withCallTurn<T>(callId: string, leadId: string, action: (token: string) => Promise<T>) {
  const filter = { callId, leadId, kind: { $in: ["interactive", "vapi"] as const } };
  const token = randomUUID();
  const result = await CallModel.updateOne({ ...filter, status: "active",
    $or: [{ turnExpiresAt: { $exists: false } }, { turnExpiresAt: { $lte: new Date() } }] },
  { $set: { turnToken: token, turnExpiresAt: new Date(Date.now() + 240_000) } });
  if (!result.matchedCount) {
    const row = await CallModel.findOne(filter).select("status").lean<{ status: CallState }>();
    if (!row) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found for this lead.");
    if (row.status === "completed") throw new ApiError(409, "CALL_ENDED", "This call has ended.");
    throw new ApiError(409, "CALL_BUSY", "A turn is already in progress.");
  }
  try {
    return await action(token);
  } finally {
    try {
      await CallModel.updateOne({ ...filter, turnToken: token }, { $unset: { turnToken: 1, turnExpiresAt: 1 } });
    } catch {
      // The lease will expire if the database is temporarily unavailable.
      console.error("Could not release a call turn lease.");
    }
  }
}

export async function endCall(callId: string, leadId: string, kind: "interactive" | "vapi" = "interactive") {
  return withCallTurn(callId, leadId, async (turnToken) => {
    const { call, metadata } = await getCall(callId);
    if (metadata.kind !== kind) throw new ApiError(404, "CALL_NOT_FOUND", "Call not found for this transport.");
    call.statusEvents.push({ status: "idle", label: "Call ended" });
    call.summary.shortSummaryForSales = `Call ended before booking a meeting. ${call.summary.recommendedNextAction}`;
    return persistCall(call, { kind: metadata.kind, turnToken });
  });
}

export async function storeStandaloneSummary(summary: CallSummary) {
  const lead = await getLead(summary.leadId);
  if (summary.bookedSlotId && !await AppointmentModel.exists({ slotId: summary.bookedSlotId, leadId: lead.id, status: "booked" })) {
    throw new ApiError(409, "BOOKING_MISMATCH", "The confirmed appointment does not belong to this lead.");
  }
  const canonical = { ...summary, leadName: lead.name, company: lead.company };
  const id = `summary_${randomUUID()}`;
  const classification = classifyLeadOutcome("", canonical);
  await SummaryModel.create({ id, leadId: lead.id, summary: canonical, classification });
  return { id, path: summariesPath(id), summary: canonical };
}

export async function readSummary(id: string) {
  const record = await SummaryModel.findOne({ id }).lean();
  if (!record) throw new ApiError(404, "SUMMARY_NOT_FOUND", "Summary not found.");
  return { id, path: summariesPath(id), summary: record.summary, classification: record.classification, callId: record.callId };
}
