import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import mongoose from "mongoose";
import { KnowledgeChunkModel, KnowledgeDocumentModel } from "../db/models.js";
import { ApiError, isDuplicate } from "../http/errors.js";
import { currentWorkspaceId } from "./workspaceContext.js";

export type KnowledgeSource = { sourceId: string; title: string; content: string };
const uploadsDir = path.resolve(process.env.KNOWLEDGE_UPLOAD_DIR || path.join(process.cwd(), "uploads", "knowledge"));
const allowed = new Map([[".pdf", new Set(["application/pdf"])], [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])], [".txt", new Set(["text/plain", "application/octet-stream"])]]);
const workspaceId = () => currentWorkspaceId();

export function splitKnowledgeText(text: string, size = Number(process.env.RAG_CHUNK_CHARS || 3200), overlap = Number(process.env.RAG_CHUNK_OVERLAP_CHARS || 480)) {
  const clean = text.replace(/\r/g, "\n").replace(/[\t\u00a0 ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(" ", end);
      if (boundary > start + size * 0.65) end = boundary;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

async function embedding(text: string): Promise<number[] | undefined> {
  if (process.env.RAG_EMBEDDINGS_ENABLED !== "true" || !process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "replace_me") return undefined;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await client.embeddings.create({ model: "text-embedding-3-small", input: text });
      const vector = result.data[0]?.embedding;
      if (!vector || vector.length !== 1536 || !vector.every(Number.isFinite)) throw new Error("Invalid embedding dimensions.");
      return vector;
    } catch (error) {
      const status = error instanceof OpenAI.APIError ? error.status : undefined;
      if (attempt === 2 || (status !== 429 && (status ?? 0) < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return undefined;
}

export async function storeKnowledgeText(title: string, content: string, documentId = "doc_" + randomUUID()) {
  const chunks = splitKnowledgeText(content);
  if (!chunks.length) throw new ApiError(422, "EMPTY_DOCUMENT", "The document contains no extractable text.");
  const wid = workspaceId();
  await mongoose.connection.transaction(async (session) => {
    await new KnowledgeDocumentModel({ documentId, workspaceId: wid, title, fileName: documentId + ".txt", contentType: "text/plain", size: Buffer.byteLength(content), status: "processing" }).save({ session });
    const records = [];
    for (const [position, text] of chunks.entries()) records.push({ documentId, workspaceId: wid, position, content: text, embedding: await embedding(text) });
    await KnowledgeChunkModel.insertMany(records, { session });
    await KnowledgeDocumentModel.updateOne({ documentId, workspaceId: wid }, { $set: { status: "indexed" } }, { session });
  });
  return { documentId, title, status: "indexed" as const, chunks: chunks.length };
}

export async function ingestKnowledgeFile(file: { originalname: string; mimetype: string; buffer: Buffer; size: number }, retryDocumentId?: string) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!allowed.get(extension)?.has(file.mimetype)) throw new ApiError(415, "UNSUPPORTED_FILE", "Upload a PDF, DOCX, or TXT file with a matching MIME type.");
  if (file.size > 10 * 1024 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "Maximum file size is 10 MB.");
  const checksum = createHash("sha256").update(file.buffer).digest("hex");
  const duplicate = retryDocumentId ? null : await KnowledgeDocumentModel.findOne({ workspaceId: workspaceId(), checksum, status: { $in: ["uploaded", "processing", "indexed", "ready"] } }).lean();
  if (duplicate) return { documentId: duplicate.documentId, title: duplicate.title, status: duplicate.status, duplicate: true };
  const documentId = retryDocumentId ?? "doc_" + randomUUID();
  const storageKey = documentId + extension;
  const title = path.basename(file.originalname, extension).slice(0, 180) || "Uploaded document";
  await mkdir(uploadsDir, { recursive: true });
  const fullPath = path.join(uploadsDir, storageKey);
  if (!retryDocumentId) {
    await writeFile(fullPath, file.buffer, { flag: "wx" });
    const doc = new KnowledgeDocumentModel({ documentId, workspaceId: workspaceId(), title, fileName: path.basename(file.originalname).slice(0, 180), contentType: file.mimetype, size: file.size, storageKey, checksum, status: "uploaded" });
    await doc.save();
  } else {
    await KnowledgeDocumentModel.updateOne({ documentId, workspaceId: workspaceId() }, { $set: { status: "processing" }, $unset: { error: 1 } });
  }
  try {
    await KnowledgeDocumentModel.updateOne({ documentId, workspaceId: workspaceId() }, { $set: { status: "processing" } });
    const bytes = await readFile(fullPath);
    let content: string;
    if (extension === ".txt") content = bytes.toString("utf8");
    else if (extension === ".docx") content = (await mammoth.extractRawText({ buffer: bytes })).value;
    else {
      const parser = new PDFParse({ data: bytes });
      try { content = (await parser.getText()).text; } finally { await parser.destroy(); }
    }
    const chunks = splitKnowledgeText(content);
    if (!chunks.length) throw new ApiError(422, "EMPTY_DOCUMENT", "The document contains no extractable text.");
    const rows = [];
    for (const [position, text] of chunks.entries()) rows.push({ documentId, workspaceId: workspaceId(), position, content: text, embedding: await embedding(text) });
    await KnowledgeChunkModel.deleteMany({ documentId, workspaceId: workspaceId() });
    await KnowledgeChunkModel.insertMany(rows);
    await KnowledgeDocumentModel.updateOne({ documentId, workspaceId: workspaceId() }, { $set: { status: "indexed" }, $unset: { error: 1 } });
    return { documentId, title, status: "indexed", chunks: chunks.length };
  } catch (error) {
    await KnowledgeDocumentModel.updateOne({ documentId, workspaceId: workspaceId() }, { $set: { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "Processing failed" } });
    throw error;
  }
}

const ignored = new Set(["what", "who", "when", "where", "which", "about", "tell", "more", "your", "you", "does", "could", "would", "please", "and", "can", "how", "have", "that", "this"]);
export async function searchKnowledge(query: string): Promise<KnowledgeSource[]> {
  return (await searchKnowledgeDetailed(query)).sources;
}

export async function searchKnowledgeDetailed(query: string): Promise<{ sources: KnowledgeSource[]; mode: "atlas_vector_search" | "mongodb_text_search_fallback" }> {
  const wid = workspaceId();
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((word) => !ignored.has(word)))].slice(0, 12);
  if (!terms.length) return { sources: [], mode: "mongodb_text_search_fallback" };
  let vector: number[] | undefined;
  try { vector = await embedding(query); } catch { /* Keep the explicitly named text-search fallback available. */ }
  let chunks: Array<{ documentId: string; position: number; content: string }> = [];
  let vectorSearchSucceeded = false;
  if (vector && process.env.MONGODB_VECTOR_INDEX) {
    try {
      chunks = await KnowledgeChunkModel.aggregate([
        { $vectorSearch: { index: process.env.MONGODB_VECTOR_INDEX, path: "embedding", queryVector: vector, numCandidates: 100, limit: 8, filter: { workspaceId: wid } } },
        { $project: { documentId: 1, position: 1, content: 1 } },
      ]);
      vectorSearchSucceeded = true;
    } catch { /* Missing index or unsupported deployment: use the labeled text fallback. */ }
  }
  if (!chunks.length) chunks = await KnowledgeChunkModel.find({ workspaceId: wid, $text: { $search: terms.join(" ") } }, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } }).limit(8).lean();
  const docs = await KnowledgeDocumentModel.find({ workspaceId: wid, documentId: { $in: chunks.map(({ documentId }) => documentId) }, status: { $in: ["indexed", "ready"] } }).select("documentId title").lean();
  const titles = new Map(docs.map((doc) => [doc.documentId, doc.title]));
  return { sources: chunks.filter((chunk) => titles.has(chunk.documentId)).slice(0, 3).map((chunk) => ({ sourceId: chunk.documentId + "_" + chunk.position, title: titles.get(chunk.documentId)!, content: chunk.content })), mode: vectorSearchSucceeded ? "atlas_vector_search" : "mongodb_text_search_fallback" };
}

export async function listKnowledgeDocuments() {
  return KnowledgeDocumentModel.find({ workspaceId: workspaceId(), status: { $ne: "deleted" } }).sort({ createdAt: -1 }).select("documentId title fileName contentType size status error createdAt").lean();
}
export async function reprocessKnowledgeDocument(documentId: string) {
  const doc = await KnowledgeDocumentModel.findOne({ documentId, workspaceId: workspaceId(), status: { $ne: "deleted" } }).lean();
  if (!doc) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found in this workspace.");
  if (!doc.storageKey) throw new ApiError(409, "DOCUMENT_NOT_REPROCESSABLE", "This text document has no uploaded source file.");
  const fullPath = path.join(uploadsDir, path.basename(doc.storageKey));
  const buffer = await readFile(fullPath);
  return ingestKnowledgeFile({ originalname: doc.fileName, mimetype: doc.contentType, buffer, size: buffer.length }, documentId);
}
export async function deleteKnowledgeDocument(documentId: string) {
  const doc = await KnowledgeDocumentModel.findOne({ documentId, workspaceId: workspaceId(), status: { $ne: "deleted" } });
  if (!doc) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found in this workspace.");
  await KnowledgeChunkModel.deleteMany({ documentId, workspaceId: workspaceId() });
  if (doc.storageKey) await unlink(path.join(uploadsDir, path.basename(doc.storageKey))).catch(() => {});
  await KnowledgeDocumentModel.updateOne({ documentId, workspaceId: workspaceId() }, { $set: { status: "deleted" } });
}

export async function seedDemoKnowledge() {
  const id = "doc_carla_evaluation";
  if (await KnowledgeDocumentModel.exists({ documentId: id, workspaceId: workspaceId() })) return;
  const content = ["Carla is an AI sales development representative that uses CRM context to personalize discovery and qualify leads.",
    "The evaluation workspace uses a mock calendar and CRM fixtures. It records bookings in the application and does not send real calendar invitations.",
    "Vapi is an optional voice transport for the evaluation. The application backend controls conversation, scheduling, and tool decisions.",
    "Pricing has not been published for the evaluation. The sales team can provide confirmed pricing."].join("\n");
  try { await storeKnowledgeText("Carla evaluation guide", content, id); } catch (error) { if (!isDuplicate(error)) throw error; }
}
