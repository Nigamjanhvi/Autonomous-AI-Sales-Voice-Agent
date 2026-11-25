import { Router } from "express";
import { listAppointments } from "../services/appointments.js";
import { readSummary } from "../services/calls.js";
import { storeKnowledgeText } from "../services/knowledge.js";
import { z } from "zod";
import { bookMeeting } from "../tools/bookMeeting.js";
import { checkCalendarAvailability } from "../tools/checkCalendarAvailability.js";
import { classifyLeadOutcome } from "../tools/classifyLeadOutcome.js";
import { saveCallSummary } from "../tools/saveCallSummary.js";
import {
  appointmentQuery, availabilityQuery, classifyBody, meetingBody, summaryBody, summaryIdParams, validated,
} from "../http/validation.js";

export const toolsRouter = Router();

const knowledgeBody = z.strictObject({ title: z.string().trim().min(1).max(180), content: z.string().trim().min(1).max(30_000) });
toolsRouter.post("/knowledge/documents", validated({ body: knowledgeBody }, async ({ body }, res) => {
  res.status(201).json({ document: await storeKnowledgeText(body.title, body.content) });
}));

toolsRouter.get("/calendar/availability", validated({ query: availabilityQuery }, async ({ query }, res) => {
  res.json({ slots: await checkCalendarAvailability(query.preferredDate) });
}));
toolsRouter.get("/appointments", validated({ query: appointmentQuery }, async ({ query }, res) => {
  res.json(await listAppointments(query));
}));
toolsRouter.post("/meetings", validated({ body: meetingBody }, async ({ body }, res) => {
  res.status(201).json({ meeting: await bookMeeting(body.leadId, body.slotId, body.notes) });
}));
toolsRouter.post("/call-summaries", validated({ body: summaryBody }, async ({ body }, res) => {
  res.status(201).json(await saveCallSummary(body));
}));
toolsRouter.get("/call-summaries/:summaryId", validated({ params: summaryIdParams }, async ({ params }, res) => {
  res.json(await readSummary(params.summaryId));
}));
toolsRouter.post("/lead-outcomes/classify", validated({ body: classifyBody }, ({ body }, res) => {
  res.json({ classification: classifyLeadOutcome(body.transcript, body.summary) });
}));
