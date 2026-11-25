import { Router } from "express";
import { runInteractiveLlmTurn, startInteractiveLlmCall } from "../agent/llmCallOrchestrator.js";
import { runCall } from "../calls/callOrchestrator.js";
import { AgentConfigurationModel } from "../db/models.js";
import { endCall, getCall, listCalls } from "../services/calls.js";
import { callIdParams, callQuery, demoBody, endBody, startBody, turnBody, validated } from "../http/validation.js";

export const callsRouter = Router();

callsRouter.get("/agent", validated({}, async (_input, res) => {
  const agent = await AgentConfigurationModel.findOne({ key: "default" })
    .select("name role gender company shortProfile -_id").lean();
  res.json({ agent });
}));
callsRouter.get("/calls", validated({ query: callQuery }, async ({ query }, res) => {
  res.json(await listCalls(query));
}));
callsRouter.get("/calls/:callId", validated({ params: callIdParams }, async ({ params }, res) => {
  const { call, metadata } = await getCall(params.callId);
  res.json({ call, metadata });
}));
callsRouter.post("/calls", validated({ body: demoBody }, async ({ body }, res) => {
  res.status(201).json({ call: await runCall(body.leadId, body.mode) });
}));
callsRouter.post("/calls/interactive/start", validated({ body: startBody }, async ({ body }, res) => {
  res.status(201).json({ call: await startInteractiveLlmCall(body.leadId) });
}));
callsRouter.post("/calls/interactive/turn", validated({ body: turnBody }, async ({ body }, res) => {
  const { transcript, ...input } = body;
  res.status(201).json({ call: await runInteractiveLlmTurn({ ...input, expectedMessageCount: transcript?.length }) });
}));
callsRouter.post("/calls/:callId/end", validated({ params: callIdParams, body: endBody }, async ({ params, body }, res) => {
  res.json({ call: await endCall(params.callId, body.leadId) });
}));
