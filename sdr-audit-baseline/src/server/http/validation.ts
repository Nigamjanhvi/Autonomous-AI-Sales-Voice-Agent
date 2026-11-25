import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { interestLevels, leadScenarios, meetingStatuses, outcomes } from "../db/models.js";

const shortText = z.string().trim().min(1).max(180);
const longText = z.string().trim().min(1).max(4000);
export const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const leadIdParams = z.strictObject({ leadId: id });
export const callIdParams = z.strictObject({ callId: id });
export const summaryIdParams = z.strictObject({ summaryId: id });
const scenario = z.enum(leadScenarios);
const outcome = z.enum(outcomes);
const mode = z.enum(["deterministic", "llm"]);
export const phone = z.string().regex(/^\+[1-9]\d{7,14}$/);

const integer = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
const paging = { page: integer(10_000).optional(), limit: integer(100).optional() };
export const leadQuery = z.strictObject({ ...paging, search: shortText.optional(), industry: shortText.optional(), scenario: scenario.optional() });
export const callQuery = z.strictObject({
  ...paging, leadId: id.optional(), outcome: outcome.optional(), mode: mode.optional(), status: z.enum(["active", "completed"]).optional(),
  kind: z.enum(["demo", "interactive", "vapi"]).optional(),
});
export const appointmentQuery = z.strictObject({
  ...paging, leadId: id.optional(), status: z.enum(["available", "held", "booked"]).optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
}).refine(({ from, to }) => !from || !to || Date.parse(from) <= Date.parse(to), { path: ["to"] });
export const availabilityQuery = z.strictObject({ preferredDate: z.iso.date().optional() });

const leadFields = z.strictObject({
  scenario, name: shortText, title: shortText, company: shortText,
  industry: shortText, companySize: shortText, currentTools: z.array(shortText).max(30),
  painHint: z.string().trim().max(2000), discussionTopic: longText,
  previousInteraction: z.string().trim().max(2000), workEmail: z.email().max(254), phoneNumber: phone.optional(),
});
export const createLeadBody = leadFields.extend({
  scenario: scenario.default("interested"), currentTools: leadFields.shape.currentTools.default([]),
  painHint: leadFields.shape.painHint.default(""), previousInteraction: leadFields.shape.previousInteraction.default(""),
});
export const updateLeadBody = leadFields.extend({ phoneNumber: phone.nullable() })
  .partial().refine((values) => Object.keys(values).length > 0);
export const demoBody = z.strictObject({ leadId: id, mode: mode.optional() });
export const startBody = z.strictObject({ leadId: id, mode: z.literal("llm") });
const transcriptEntry = z.strictObject({ speaker: z.enum(["agent", "lead"]), name: shortText, message: longText });
export const turnBody = z.strictObject({
  leadId: id, callId: id.optional(), transcript: z.array(transcriptEntry).max(100).optional(), leadReply: longText,
});
export const endBody = z.strictObject({ leadId: id });
export const meetingBody = z.strictObject({ leadId: id, slotId: id, notes: z.string().trim().max(4000).optional() });
const summaryFields = z.strictObject({
  leadId: id, leadName: shortText, company: shortText, painPoints: z.array(shortText).max(50),
  objections: z.array(shortText).max(50), interestLevel: z.enum(interestLevels), meetingStatus: z.enum(meetingStatuses),
  bookedSlotId: id.optional(), recommendedNextAction: longText, shortSummaryForSales: longText,
});
export const summaryBody = summaryFields.refine((summary) => (summary.meetingStatus === "booked") === Boolean(summary.bookedSlotId), { path: ["bookedSlotId"] });
export const classifyBody = z.strictObject({
  transcript: z.string().max(100_000).optional(),
  summary: summaryFields.partial().optional(),
});

export const vapiStartBody = z.strictObject({ leadId: id, customerNumber: phone.optional() });
const metadata = z.object({ leadId: id.optional() });
const overrides = z.object({ metadata: metadata.optional(), variableValues: metadata.optional() });
const vapiCall = z.object({ id: z.string().min(1).max(95).regex(/^[\w-]+$/).optional(), metadata: metadata.optional(),
  assistantOverrides: overrides.optional(), variableValues: metadata.optional() });
export const vapiCompletionBody = z.object({
  messages: z.array(z.object({ role: z.string().max(40).optional(), content: z.union([
    z.string().max(12_000), z.array(z.object({ text: z.string().max(4000).optional(), type: z.string().max(50).optional() })).max(20),
  ]).nullish() })).max(100).optional(),
  call: vapiCall.optional(), metadata: metadata.optional(), assistantOverrides: overrides.optional(),
});
export const vapiWebhookBody = z.object({ message: z.object({ type: shortText, call: vapiCall.optional() }) });

const emptyQuery = z.strictObject({});
type Source<T> = { parse(value: unknown): T };
export function validated<P, Q, B>(
  schemas: { params?: Source<P>; query?: Source<Q>; body?: Source<B> },
  handler: (input: { params: P; query: Q; body: B; req: Request }, res: Parameters<RequestHandler>[1]) => unknown,
): RequestHandler {
  return async (req, res) => {
    const params = schemas.params ? schemas.params.parse(req.params) : (emptyQuery.parse(req.params) as P);
    const query = schemas.query ? schemas.query.parse(req.query) : (emptyQuery.parse(req.query) as Q);
    const body = schemas.body ? schemas.body.parse(req.body) : (z.undefined().parse(req.body) as B);
    await handler({ params, query, body, req }, res);
  };
}
