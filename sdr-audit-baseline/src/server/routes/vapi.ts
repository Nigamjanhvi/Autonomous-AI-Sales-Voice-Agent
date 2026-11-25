import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Request } from "express";
import { runInteractiveLlmTurn, startInteractiveLlmCall } from "../agent/llmCallOrchestrator.js";
import { ApiError } from "../http/errors.js";
import { turnBody, validated, vapiCompletionBody, vapiStartBody, vapiWebhookBody } from "../http/validation.js";
import { callIsComplete } from "../services/calls.js";
import { getVapiConfig, handleVapiCustomLlmCompletion, handleVapiWebhook, startVapiVoiceCall } from "../vapi/vapiVoiceService.js";

export const vapiRouter = Router();

function verifyVapiRequest(req: Request, required = false) {
  const secret = process.env.VAPI_SHARED_SECRET?.trim();
  if (!secret) {
    if (required) throw new ApiError(503, "VAPI_NOT_CONFIGURED", "VAPI_SHARED_SECRET is required for real outbound calls.");
    return;
  }
  const actual = Buffer.from(req.get("authorization") ?? "");
  const expected = Buffer.from("Bearer " + secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ApiError(401, "UNAUTHORIZED", "Vapi authorization failed.");
  }
}

vapiRouter.get("/vapi/config", validated({}, (_input, res) => {
  res.json({ vapi: getVapiConfig() });
}));
vapiRouter.post("/vapi/calls", validated({ body: vapiStartBody }, async ({ body, req }, res) => {
  if (getVapiConfig().allowOutboundCalls) verifyVapiRequest(req, true);
  res.status(201).json({ vapi: await startVapiVoiceCall(body) });
}));
vapiRouter.post("/vapi/webhook", validated({ body: vapiWebhookBody }, async ({ body, req }, res) => {
  verifyVapiRequest(req);
  res.json(await handleVapiWebhook(body));
}));
vapiRouter.post("/vapi/chat/completions", validated({ body: vapiCompletionBody }, async ({ body, req }, res) => {
  verifyVapiRequest(req);
  res.json(await handleVapiCustomLlmCompletion(body));
}));
vapiRouter.post("/vapi/turn", validated({ body: turnBody }, async ({ body, req }, res) => {
  verifyVapiRequest(req);
  const prior = await startInteractiveLlmCall(body.leadId, { providerCallId: body.callId });
  const call = callIsComplete(prior) ? prior : await runInteractiveLlmTurn({
    callId: prior.callId, leadId: body.leadId, leadReply: body.leadReply, kind: "vapi",
  });
  res.status(201).json({ call, message: call.transcript.at(-1)?.message });
}));
