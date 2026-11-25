import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { KnowledgeChunkModel, KnowledgeDocumentModel } from "../db/models.js";
import { isDuplicate } from "../http/errors.js";

export type KnowledgeSource = { sourceId: string; title: string; content: string };

export async function storeKnowledgeText(title: string, content: string, documentId = "doc_" + randomUUID()) {
  const chunks = (content.match(/[^\r\n]+/g) ?? [])
    .flatMap((line) => line.trim().match(/.{1,700}(?:\s|$)|.{1,700}/gu) ?? [])
    .map((chunk) => chunk.trim()).filter(Boolean);
  await mongoose.connection.transaction(async (session) => {
    await new KnowledgeDocumentModel({ documentId, title, fileName: documentId + ".txt",
      contentType: "text/plain", size: Buffer.byteLength(content), status: "ready" }).save({ session });
    await KnowledgeChunkModel.insertMany(chunks.map((text, position) => ({ documentId, position, content: text })), { session });
  });
  return { documentId, title, status: "ready" as const, chunks: chunks.length };
}

const ignored = new Set(["what", "who", "when", "where", "which", "about", "tell", "more", "your", "you", "does", "could", "would", "please", "and", "can", "how", "have", "that", "this"]);
export async function searchKnowledge(query: string): Promise<KnowledgeSource[]> {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const terms = [...new Set(words.filter((word) => !ignored.has(word)))].slice(0, 12);
  if (!terms.length) return [];
  const chunks = await KnowledgeChunkModel.find({ $text: { $search: terms.join(" ") } },
    { score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).limit(12).lean();
  const documents = await KnowledgeDocumentModel.find({ documentId: { $in: chunks.map((chunk) => chunk.documentId) }, status: "ready" })
    .select("documentId title").lean();
  const titles = new Map(documents.map((doc) => [doc.documentId, doc.title]));
  return chunks.filter((chunk) => titles.has(chunk.documentId)).slice(0, 3).map((chunk) => ({
    sourceId: chunk.documentId + "_" + chunk.position, title: titles.get(chunk.documentId)!, content: chunk.content,
  }));
}

export async function seedDemoKnowledge() {
  const id = "doc_carla_evaluation";
  if (await KnowledgeDocumentModel.exists({ documentId: id })) return;
  const content = [
    "Carla is an AI sales development representative that uses CRM context to personalize discovery and qualify leads.",
    "The evaluation workspace uses a mock calendar and CRM fixtures. It records bookings in the application and does not send real calendar invitations.",
    "Vapi is an optional voice transport for the evaluation. The application backend controls conversation, scheduling, and tool decisions.",
    "Pricing has not been published for the evaluation. The sales team can provide confirmed pricing.",
  ].join("\n");
  try { await storeKnowledgeText("Carla evaluation guide", content, id); }
  catch (error) { if (!isDuplicate(error)) throw error; }
}
