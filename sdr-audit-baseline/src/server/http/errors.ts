import type { ErrorRequestHandler } from "express";
import OpenAI from "openai";
import { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isDuplicate(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) { next(error); return; }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message, code: error.code });
  } else if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request.", code: "VALIDATION_ERROR",
      issues: error.issues.map(({ path, code }) => ({ path: path.join("."), code })) });
  } else if (isDuplicate(error)) {
    res.status(409).json({ error: "This record already exists.", code: "DUPLICATE_RECORD" });
  } else if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large.", code: "PAYLOAD_TOO_LARGE" });
  } else if (error instanceof Error && "type" in error && error.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON.", code: "INVALID_JSON" });
  } else if (error instanceof Error && "type" in error && error.type === "encoding.unsupported") {
    res.status(415).json({ error: "Unsupported body encoding.", code: "UNSUPPORTED_ENCODING" });
  } else if (error instanceof OpenAI.APIError) {
    res.status(502).json({ error: "The AI provider could not complete the request.", code: "OPENAI_REQUEST_FAILED" });
  } else if (error instanceof Error && ["MongoNetworkError", "MongoNetworkTimeoutError", "MongoServerSelectionError", "MongooseServerSelectionError", "MongoNotConnectedError"].includes(error.name)) {
    res.status(503).json({ error: "Database unavailable.", code: "DATABASE_UNAVAILABLE" });
  } else {
    // Driver and provider errors can contain connection strings or customer data.
    console.error("API request failed.");
    res.status(500).json({ error: "Unexpected server error.", code: "INTERNAL_ERROR" });
  }
};
