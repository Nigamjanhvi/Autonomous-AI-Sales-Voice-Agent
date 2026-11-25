import cors from "cors";
import express from "express";
import { databaseHealthy } from "./db/connection.js";
import { handleError } from "./http/errors.js";
import { validated } from "./http/validation.js";
import { callsRouter } from "./routes/calls.js";
import { leadsRouter } from "./routes/leads.js";
import { toolsRouter } from "./routes/tools.js";
import { vapiRouter } from "./routes/vapi.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  const clientOrigin = process.env.CLIENT_ORIGIN?.trim() || "http://localhost:5173";
  app.use(cors({ origin: clientOrigin }));
  app.use(express.json({ limit: "512kb", inflate: false }));
  app.get("/health", validated({}, async (_input, res) => {
    const ok = await databaseHealthy();
    res.status(ok ? 200 : 503).json({ ok, service: "ai-sdr" });
  }));
  app.get("/health/db", validated({}, async (_input, res) => {
    const ok = await databaseHealthy();
    res.status(ok ? 200 : 503).json({ ok, database: ok ? "up" : "down" });
  }));
  app.use("/api", toolsRouter);
  app.use("/api", leadsRouter);
  app.use("/api", callsRouter);
  app.use("/api", vapiRouter);
  app.use((_req, res) => { res.status(404).json({ error: "Route not found.", code: "ROUTE_NOT_FOUND" }); });
  app.use(handleError);
  return app;
}
