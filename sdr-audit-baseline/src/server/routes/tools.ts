import { Router } from "express";
import { listAppointments } from "../services/appointments.js";
import { readSummary } from "../services/calls.js";
import { z } from "zod";
import { bookMeeting } from "../tools/bookMeeting.js";
import { checkCalendarAvailability } from "../tools/checkCalendarAvailability.js";
import { classifyLeadOutcome } from "../tools/classifyLeadOutcome.js";
import { saveCallSummary } from "../tools/saveCallSummary.js";
import multer from "multer";
import { KnowledgeChunkModel, KnowledgeDocumentModel } from "../db/models.js";
import { currentWorkspaceId } from "../services/workspaceContext.js";
import { deleteKnowledgeDocument, ingestKnowledgeFile, listKnowledgeDocuments, reprocessKnowledgeDocument, searchKnowledgeDetailed, storeKnowledgeText } from "../services/knowledge.js";
import {
  appointmentQuery, availabilityQuery, classifyBody, meetingBody, summaryBody, summaryIdParams, validated,
} from "../http/validation.js";

export const toolsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const knowledgeBody = z.strictObject({ title: z.string().trim().min(1).max(180), content: z.string().trim().min(1).max(30_000) });
toolsRouter.post("/knowledge/documents", validated({ body: knowledgeBody }, async ({ body }, res) => {
  res.status(201).json({ document: await storeKnowledgeText(body.title, body.content) });
}));
toolsRouter.post("/knowledge/documents/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) { res.status(400).json({ error: "Choose a file to upload.", code: "FILE_REQUIRED" }); return; }
    res.status(201).json({ document: await ingestKnowledgeFile(req.file) });
  } catch (error) { next(error); }
});
toolsRouter.get("/knowledge/documents", async (_req, res, next) => {
  try { res.json({ documents: await listKnowledgeDocuments() }); } catch (error) { next(error); }
});
toolsRouter.get("/knowledge/search", async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 350) : "";
    if (!query) { res.status(400).json({ error: "Search query is required.", code: "INVALID_QUERY" }); return; }
    res.json(await searchKnowledgeDetailed(query));
  } catch (error) { next(error); }
});
toolsRouter.get("/knowledge/documents/:documentId", async (req, res, next) => {
  try {
    const document = await KnowledgeDocumentModel.findOne({ documentId: req.params.documentId, workspaceId: currentWorkspaceId(), status: { $ne: "deleted" } }).select("documentId title fileName contentType size status error createdAt").lean();
    if (!document) { res.status(404).json({ error: "Document not found in this workspace.", code: "DOCUMENT_NOT_FOUND" }); return; }
    const chunks = await KnowledgeChunkModel.find({ documentId: document.documentId, workspaceId: currentWorkspaceId() }).sort({ position: 1 }).select("position content").lean();
    res.json({ document, chunks });
  } catch (error) { next(error); }
});
toolsRouter.post("/knowledge/documents/:documentId/reprocess", async (req, res, next) => {
  try { res.json({ document: await reprocessKnowledgeDocument(req.params.documentId) }); } catch (error) { next(error); }
});
toolsRouter.delete("/knowledge/documents/:documentId", async (req, res, next) => {
  try { await deleteKnowledgeDocument(req.params.documentId); res.status(204).end(); } catch (error) { next(error); }
});

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
