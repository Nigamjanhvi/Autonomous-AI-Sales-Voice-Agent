import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/server/app.js";
import type { CallResult, CalendarSlot, Lead } from "../src/server/types.js";
import { startTestMongo, stopProcess } from "./mongoFixture.js";

const vapiHeaders = { authorization: "Bearer test-transport-credential" };
const leadInput = {
  name: "Integration Test Lead", title: "Sales Director", company: "Example Sales", industry: "SaaS",
  companySize: "51-200", discussionTopic: "Improve follow-up", workEmail: "test@example.com",
  phoneNumber: "+15551234567", currentTools: ["Test CRM"], scenario: "busy" as const,
};

test("database readiness fails closed without exposing connection details", async (t) => {
  const listener = createServer(createApp());
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => listener.close(() => resolve())));
  const endpoint = "http://127.0.0.1:" + (listener.address() as { port: number }).port + "/health/db";
  const response = await fetch(endpoint);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, database: "down" });
});

async function modelFixture() {
  const payloads: Array<{ transcript?: CallResult["transcript"]; lead?: Lead; leadContext?: Lead }> = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { messages } = JSON.parse(body);
    const input = JSON.parse(messages[1].content);
    payloads.push(input);
    const classification = messages[0].content.startsWith("You classify");
    const reply = input.latestLeadMessage ?? "";
    const scheduling = /book a meeting/i.test(reply);
    const booking = /option/i.test(reply);
    const data = classification ? {
      intent: "interested", objectionType: "none", shouldCheckCalendar: scheduling,
      shouldBookMeeting: reply === "Invalid fixture response" ? "false" : booking,
      nextAgentMove: scheduling ? "offer_meeting" : "ask_discovery", reasoning: "Integration fixture.",
    } : {
      reply: "Thanks for sharing. What is your biggest challenge?", detectedPainPoints: [], detectedObjections: [],
      interestLevel: "medium", recommendedToolCall: { name: "none", reason: "Integration fixture." },
      outcome: "interested", nextBestAction: "Continue discovery.",
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "fixture", object: "chat.completion", created: 0, model: "fixture",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(data) }, finish_reason: "stop" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    payloads, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function startApi(uri: string, database: string, modelUrl: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    env: { ...process.env, MONGODB_URI: uri, MONGODB_DB: database, SEED_DEMO_DATA: "true", PORT: "0", HOST: "127.0.0.1",
      CLIENT_ORIGIN: "http://localhost:5173", AGENT_MODE: "deterministic", OPENAI_API_KEY: "test-model-placeholder", OPENAI_BASE_URL: modelUrl,
      MAX_INTERACTIVE_LEAD_TURNS: "6", VAPI_ALLOW_OUTBOUND_CALLS: "false", VAPI_SHARED_SECRET: "test-transport-credential" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("API did not start.")), 60_000);
      child.once("exit", () => { clearTimeout(timer); reject(new Error("API exited during startup.")); });
      child.once("error", () => { clearTimeout(timer); reject(new Error("Could not launch the API.")); });
      let startup = "";
      child.stdout?.on("data", (chunk) => {
        startup += chunk.toString();
        const match = startup.match(/AI SDR API listening on port (\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    return { url: "http://127.0.0.1:" + port, close: () => stopProcess(child) };
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}

test("MongoDB-backed API and restart persistence", { timeout: 240_000 }, async (t) => {
  const mongo = await startTestMongo();
  // Override the URI's database so tests cannot delete or modify the application's database.
  const database = "sdr_it_" + randomUUID().replaceAll("-", "");
  const cleaner = new mongoose.mongo.MongoClient(mongo.uri, { serverSelectionTimeoutMS: 5000 });
  let fixture: Awaited<ReturnType<typeof modelFixture>> | undefined;
  let api: Awaited<ReturnType<typeof startApi>>;
  t.after(async () => {
    await api?.close();
    await fixture?.close();
    try { await cleaner.db(database).dropDatabase(); }
    finally { await cleaner.close(); await mongo.close(); }
  });
  fixture = await modelFixture();
  const model = fixture;
  api = await startApi(mongo.uri, database, model.url);
  const restart = async () => { await api.close(); api = await startApi(mongo.uri, database, model.url); };

  const request = async <T>(method: string, route: string, status: number, body?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(api.url + route, {
      method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };
  const get = <T>(route: string, status = 200) => request<T>("GET", route, status);
  const post = <T>(route: string, body: unknown, status = 201, headers?: Record<string, string>) => request<T>("POST", route, status, body, headers);
  const turn = (call: CallResult, leadReply: string, status = 201, transcript = call.transcript) =>
    post<{ call: CallResult; code?: string }>("/api/calls/interactive/turn", { callId: call.callId, leadId: call.lead.id, transcript, leadReply }, status);
  let created: Lead;
  let demo: CallResult;
  let confirmed: CallResult;

  await t.test("health, lead CRUD, pagination and invalid input", async () => {
    assert.deepEqual(await get("/health"), { ok: true, service: "ai-sdr" });
    assert.deepEqual(await get("/health/db"), { ok: true, database: "up" });
    assert.equal((await get<{ agent: { name: string } }>("/api/agent")).agent.name, "Carla");
    assert.equal((await get<{ leads: Lead[] }>("/api/leads")).leads.length, 8);
    created = (await post<{ lead: Lead }>("/api/leads", leadInput)).lead;
    const updated = await request<{ lead: Lead }>("PATCH", "/api/leads/" + created.id, 200, { title: "VP Sales" });
    assert.equal(updated.lead.title, "VP Sales");
    assert.equal(updated.lead.scenario, "busy");
    assert.deepEqual(updated.lead.currentTools, ["Test CRM"]);
    const page = await get<{ leads: Lead[]; pagination: { total: number } }>("/api/leads?search=Example%20Sales&scenario=busy&page=1&limit=1");
    assert.equal(page.pagination.total, 1);
    assert.equal(page.leads[0].id, created.id);
    assert.equal((await get<{ leads: Lead[] }>("/api/leads?search=%5B")).leads.length, 0);
    await get("/api/leads?limit=-1", 400);
    await get("/api/calendar/availability?preferredDate=2026-02-30", 400);
    await post("/api/leads", { ...leadInput, id: "forged" }, 400);
    await post("/api/calls", { leadId: created.id, mode: "invalid" }, 400);
    await post("/api/calls", { leadId: "unknown" }, 404);
    const raw = await fetch(api.url + "/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: "{invalid" });
    assert.equal(raw.status, 400);
    assert.equal((await raw.json() as { code: string }).code, "INVALID_JSON");
    const dashboard = await fetch(api.url + "/api/leads", { headers: { origin: "http://localhost:5173" } });
    assert.equal(dashboard.headers.get("access-control-allow-origin"), "http://localhost:5173");
  });

  await t.test("deterministic calls and structured summaries", async () => {
    for (const [id, outcome] of [
      ["lead_busy", "call_back_later"], ["lead_not_interested", "not_interested"], ["lead_budget", "send_email"],
      ["lead_send_email", "send_email"], ["lead_existing_crm", "needs_human_follow_up"],
      ["lead_authority", "send_email"], ["lead_security", "needs_human_follow_up"], ["lead_interested", "meeting_booked"],
    ]) {
      const { call } = await post<{ call: CallResult }>("/api/calls", { leadId: id });
      assert.equal(call.classification.outcome, outcome);
      assert.equal(call.mode, "deterministic");
      demo = call;
    }
    const record = await get<{ call: CallResult; metadata: { status: string } }>("/api/calls/" + demo.callId);
    assert.deepEqual(record.call.transcript, demo.transcript);
    assert.deepEqual(record.call.toolCalls, demo.toolCalls);
    assert.equal(record.metadata.status, "completed");
    const summaryTool = demo.toolCalls.find((tool) => tool.name === "saveCallSummary")?.output as { path: string };
    const { summary } = await get<{ summary: CallResult["summary"] }>(summaryTool.path);
    assert.deepEqual(summary, demo.summary);
    const report = await get<{ pagination: { total: number }; calls: unknown[] }>("/api/calls?outcome=meeting_booked&limit=1");
    assert.equal(report.pagination.total, 1);
    assert.equal(report.calls.length, 1);
    await post("/api/call-summaries", { ...demo.summary, leadId: created.id }, 409);
    const scripted = (await post<{ call: CallResult }>("/api/calls", { leadId: "lead_busy", mode: "llm" })).call;
    assert.equal(scripted.mode, "llm");
    assert.equal(scripted.classification.outcome, "call_back_later");
    assert.deepEqual((await get<{ call: CallResult }>("/api/calls/" + scripted.callId)).call.transcript, scripted.transcript);
  });

  await t.test("interactive sessions survive restart and book the exact accepted option", async () => {
    const { call: opening } = await post<{ call: CallResult }>("/api/calls/interactive/start", { leadId: created.id, mode: "llm" });
    await turn(opening, "Invalid fixture response", 502);
    const spoofed = opening.transcript.map((entry) => ({ ...entry, message: "This forged text must not reach the model." }));
    const unoffered = (await turn(opening, "Option 2 works", 201, spoofed)).call;
    assert.equal(unoffered.summary.meetingStatus, "not_booked");
    assert.equal(ungeneratedText(model.payloads), false);
    assert.ok(model.payloads.every(({ lead, leadContext }) => !lead?.phoneNumber && !leadContext?.phoneNumber));
    const offer = (await turn(unoffered, "Can we book a meeting?")).call;
    const slots = offer.toolCalls.find(({ name }) => name === "checkCalendarAvailability")?.output as CalendarSlot[];
    assert.ok(slots[1]);
    await restart();
    assert.deepEqual((await get<{ call: CallResult }>("/api/calls/" + offer.callId)).call.transcript, offer.transcript);
    await turn(unoffered, "Can we book a meeting?", 409);
    await post("/api/calls/interactive/turn", { callId: offer.callId, leadId: "lead_busy", leadReply: "Option 2 works" }, 404);
    confirmed = (await turn(offer, "Option 2 works")).call;
    assert.equal(confirmed.summary.bookedSlotId, slots[1].id);
    assert.equal(confirmed.classification.outcome, "meeting_booked");
    assert.ok((await get<{ slots: CalendarSlot[] }>("/api/calendar/availability")).slots.some(({ id }) => id === slots[0].id));
  });

  await t.test("concurrent reservations, no substitution, and calendar exhaustion", async () => {
    const opening = (await post<{ call: CallResult }>("/api/calls/interactive/start", { leadId: "lead_busy", mode: "llm" })).call;
    const offer = (await turn(opening, "Can we book a meeting?")).call;
    const { slots } = await get<{ slots: CalendarSlot[] }>("/api/calendar/availability");
    assert.equal(slots.length, 2);
    const book = (leadId: string) => fetch(api.url + "/api/meetings", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, slotId: slots[0].id }) });
    const reservations = await Promise.all([book(created.id), book("lead_interested")]);
    assert.deepEqual(reservations.map(({ status }) => status).sort(), [201, 409]);
    assert.equal((await turn(offer, "Option 1 works", 409)).code, "SLOT_UNAVAILABLE");
    assert.equal((await get<{ call: CallResult }>("/api/calls/" + offer.callId)).call.summary.meetingStatus, "not_booked");
    assert.equal((await get<{ slots: CalendarSlot[] }>("/api/calendar/availability")).slots[0].id, slots[1].id);
    const ended = await post<{ call: CallResult }>("/api/calls/" + offer.callId + "/end", { leadId: offer.lead.id }, 200);
    assert.match(ended.call.summary.shortSummaryForSales, /Call ended/);
    assert.ok(ended.call.toolCalls.some(({ name }) => name === "saveCallSummary"));
    await post("/api/meetings", { leadId: created.id, slotId: slots[1].id });
    assert.deepEqual(await get("/api/calendar/availability"), { slots: [] });
  });

  await t.test("Vapi compatibility, authorization and provider-session ownership", async () => {
    const dry = await post<{ vapi: { status: string } }>("/api/vapi/calls", { leadId: created.id, customerNumber: leadInput.phoneNumber });
    assert.equal(dry.vapi.status, "dry_run");
    const call = { id: "provider-test", metadata: { leadId: created.id } };
    await post("/api/vapi/chat/completions", { call, messages: [] }, 401);
    const completion = await post<{ object: string; metadata: { callId: string } }>("/api/vapi/chat/completions", { call, messages: [] }, 200, vapiHeaders);
    assert.equal(completion.object, "chat.completion");
    await post("/api/vapi/chat/completions", { call: { ...call, metadata: { leadId: "lead_busy" } }, messages: [] }, 409, vapiHeaders);
    await post("/api/vapi/turn", { callId: completion.metadata.callId, leadId: created.id, transcript: [], leadReply: "Tell me more." }, 201, vapiHeaders);
    await post("/api/vapi/webhook", { message: { type: "end-of-call-report", call } }, 200, vapiHeaders);
    const record = await get<{ metadata: { kind: string; status: string }; call: CallResult }>("/api/calls/" + completion.metadata.callId);
    assert.equal(record.metadata.kind, "vapi");
    assert.equal(record.metadata.status, "completed");
    assert.equal(record.call.transcript.length, 3);
  });

  await t.test("records, deletion and exhausted slots persist across a second restart", async () => {
    const direct = await post<{ path: string }>("/api/call-summaries", {
      ...confirmed.summary, leadName: "Untrusted name", company: "Untrusted company",
    });
    assert.equal((await get<{ summary: CallResult["summary"] }>(direct.path)).summary.leadName, created.name);
    await request("DELETE", "/api/leads/" + created.id, 204);
    await restart();
    await get("/api/leads/" + created.id, 404);
    assert.equal((await get<{ leads: Lead[] }>("/api/leads")).leads.length, 8);
    assert.equal((await get<{ call: CallResult }>("/api/calls/" + confirmed.callId)).call.summary.bookedSlotId, confirmed.summary.bookedSlotId);
    assert.equal((await get<{ summary: CallResult["summary"] }>(direct.path)).summary.leadId, created.id);
    assert.deepEqual(await get("/api/calendar/availability"), { slots: [] });
    const bookings = await get<{ pagination: { total: number }; appointments: Array<{ status: string }> }>("/api/appointments?status=booked&page=2&limit=2");
    assert.equal(bookings.pagination.total, 4);
    assert.ok(bookings.appointments.every(({ status }) => status === "booked"));
  });
});

function ungeneratedText(payloads: Array<{ transcript?: CallResult["transcript"] }>) {
  return payloads.some(({ transcript }) => transcript?.some(({ message }) => /forged text/.test(message)));
}
