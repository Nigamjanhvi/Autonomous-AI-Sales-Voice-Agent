# SDR Calling Agent

An outbound SDR (sales development representative) calling agent. It runs a structured sales
conversation against mock CRM context, handles common objections, books qualified meetings through
real tool calls, and produces a structured post-call summary and outcome classification.

The agent brain lives entirely in this backend. A voice layer (Vapi) is integrated as an optional
transport for speech-to-text and text-to-speech only — it never owns the conversation logic.

## Stack

- React + TypeScript + Vite frontend
- Node.js + TypeScript + Express backend
- OpenAI SDK for LLM agent turns (optional mode)
- `@vapi-ai/server-sdk` / `@vapi-ai/web` for the optional voice layer
- MongoDB Atlas with Mongoose and optional demo seed fixtures

## Quick guide (Hinglish)

For step-by-step local startup, every dashboard feature check, interactive English/Hindi examples,
Vapi browser voice credential mapping and troubleshooting, read
[`docs/USER_GUIDE_HINGLISH.md`](docs/USER_GUIDE_HINGLISH.md). The guide distinguishes configured
features from external integrations that still need live verification.

## Current Vapi setup (v3, as reported)

The owner reports that Carla assistant **v3 is published with 100% traffic**. The Vapi dashboard and
ngrok account were not inspected by this code review, so this is recorded as user-reported
configuration, not independently verified. The browser uses Vapi for audio; Carla's backend owns
conversation policy, tool calls, and MongoDB writes.

### Custom LLM endpoint

Reported Vapi values: Provider `Custom LLM`, model label `gpt-4.1-mini`, base URL
`https://YOUR_NGROK_DOMAIN/api/vapi`, endpoint suffix `/chat/completions`, temperature `0.5`, and
maximum tokens `250`. The resolved endpoint must be:

```text
https://YOUR_NGROK_DOMAIN/api/vapi/chat/completions
```

The application route is `POST /api/vapi/chat/completions`. It expects call ID and lead ID metadata
and returns a normal JSON chat-completion response. The backend does not implement SSE streaming.
The backend LLM request uses `.env` `OPENAI_MODEL` and `MAX_OUTPUT_TOKENS`; it does not forward the
Vapi request's model, temperature, or token limit. Set `OPENAI_MODEL=gpt-4.1-mini` and, if desired,
`MAX_OUTPUT_TOKENS=250` in the backend environment to align model/token settings. Temperature is
not currently configurable in the backend request. Do not assume the Vapi UI's `0.5` is applied.

### Assistant Server URL webhook

Separately, the reported Vapi Assistant Server URL is:

```text
https://YOUR_NGROK_DOMAIN/api/vapi/webhook
```

Use the `Carla Backend Auth` Bearer credential. The route is `POST /api/vapi/webhook`; its current
backend handler acts on `end-of-call-report` to finalize an active call. It does not implement
server-side call-started, status-update, or transcript event processing. Browser SDK events are
handled separately in the frontend. The webhook supports call lifecycle finalization; it is not the
Custom LLM turn endpoint.

### Local ngrok testing

Vapi's servers cannot call a laptop's `localhost`, so ngrok must forward public HTTPS traffic to the
local Express port. After installing/authenticating the ngrok CLI, use three terminals from
`sdr-audit-baseline`:

```powershell
# Terminal 1: Express backend
npm.cmd run dev:server
```

```powershell
# Terminal 2: Vite frontend
npm.cmd run dev:client
```

```powershell
# Terminal 3: ngrok (external CLI command, not an npm script)
ngrok http 3001
```

Alternatively, run frontend and backend together in Terminal 1 with `npm.cmd run dev`, and run only
ngrok in Terminal 2. Copy the HTTPS forwarding host printed by ngrok into `VAPI_PUBLIC_BASE_URL`,
then set the Vapi Custom LLM base URL and Assistant Server URL as above. If the ngrok host changes,
update all three locations and restart the app so `.env` is reloaded. Keep the secret credential
value only in `.env` and Vapi's credential store; do not paste it into source code, logs, or docs.

### Test the browser voice flow

1. Confirm `http://localhost:3001/health/db` returns database status `up`.
2. Start the local frontend and backend, then the ngrok tunnel.
3. Open `http://localhost:5173` → **Live Calls** → choose a lead → **Start call** → **Vapi Live Voice**.
4. Allow microphone access. Wait for the connected/listening state, then speak a short test request.
5. End the call. Check **Call History** and `GET /api/calls`, then inspect a record with
   `GET /api/calls/:callId`.

### Configuration and verification status

| Item | Status |
|---|---|
| Assistant v3, 100% traffic allocation | Configured/published per owner report; dashboard not independently inspected |
| Custom LLM and webhook URLs / Bearer credential | Configured per owner report; no live request verified in this session |
| Backend routes and UI integration | Present in source; automated route test uses a test credential/model stub |
| Live browser voice via current ngrok URL | Not yet verified from this session |
| Real end-of-call webhook receipt and summary finalization | Not yet verified against Vapi |
| Real PSTN outbound call | Not tested; keep `VAPI_ALLOW_OUTBOUND_CALLS=false` during browser testing |

Troubleshooting and environment variable meanings are in [`docs/USER_GUIDE_HINGLISH.md`](docs/USER_GUIDE_HINGLISH.md).

## Setup

Use Node.js 22.12 or newer and MongoDB Atlas or a local MongoDB replica set. In Atlas, create a database user with `readWrite` on the application database, allow the application host's IP, and copy the driver connection URI. [Atlas connection setup](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/)

Copy `.env.example` to the ignored `.env`. Set `MONGODB_URI` to the driver URI and `MONGODB_DB` to your database name. Keep `SEED_DEMO_DATA=true` to load the eight demo leads and future appointment slots on first startup.

```powershell
npm.cmd ci
npm.cmd run dev
```

For local development with MongoDB and Mongosh installed, start a replica set in one PowerShell terminal and initialize it once from another:

```powershell
# Terminal 1
New-Item -ItemType Directory -Force .\mongo-dev-data | Out-Null
mongod --dbpath .\mongo-dev-data --bind_ip 127.0.0.1 --port 27017 --replSet sdr-dev

# Terminal 2
mongosh --host 127.0.0.1 --port 27017 --eval 'rs.initiate({_id:"sdr-dev",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Set the local `MONGODB_URI` to `mongodb://127.0.0.1:27017/?replicaSet=sdr-dev`. The API binds to loopback by default. Set `CLIENT_ORIGIN` if you serve Vite from a different origin. Shared deployments need application authentication and tenant-scoped access before exposing CRM and call data.

The backend health endpoint runs on:

```text
GET http://localhost:3001/health
```

Expected response:

```json
{ "ok": true, "service": "ai-sdr" }
```

`GET /health/db` reports `{"ok":true,"database":"up"}` after a database ping and returns HTTP 503 when unavailable.

## Scripts

```bash
npm run dev        # frontend and backend together
npm run dev:client # Vite frontend only
npm run dev:server # Express backend only
npm run build      # TypeScript check and Vite build
npm run lint       # oxlint
npm test           # HTTP integration tests and restart verification
```

Tests start a disposable local replica set when `mongod` is on PATH. Set `MONGOD_BINARY` if it lives elsewhere, or set `MONGODB_TEST_URI` to a dedicated test replica set with permission to create and drop a uniquely named database. AI requests in the tests use a local stub.

## Design direction

The dashboard includes a **Live Calls** console for Carla's conversation, call duration, tools,
and outcome. It also includes a lead directory, appointment calendar, backend knowledge files,
reporting, and agent preferences.

The screen keeps the agent (Carla) centered with a CSS-only speaking/thinking/listening indicator, a
clear End Call button, and a side transcript panel with visually separated agent and lead bubbles. A
small Recent actions area surfaces tool activity labels such as `CRM loaded`, `Calendar checked`,
`Meeting booked`, and `Summary saved`.

The agent's display name and profile come from a separate config file
(`src/server/config/agent.config.ts`) rather than being hardcoded in UI components. Lead records
include `companySize` and `discussionTopic`; the agent uses `companySize` to qualify and adapt the
pitch and `discussionTopic` to open with relevant context.

After the call ends, the outcome panel shows the classification, meeting status, interest level,
recommended next action, and call note. In production, the same backend call orchestration could
back an internal sales console or a real voice call experience.

## HTTP API

```text
GET  /api/leads
POST /api/leads
GET  /api/leads/:leadId
PATCH /api/leads/:leadId
DELETE /api/leads/:leadId
GET  /api/calendar/availability
GET  /api/calendar/availability?preferredDate=YYYY-MM-DD
POST /api/meetings
GET  /api/appointments
POST /api/call-summaries
GET  /api/call-summaries/:summaryId
POST /api/lead-outcomes/classify
GET  /api/agent
POST /api/calls
GET  /api/calls
GET  /api/calls/:callId
POST /api/calls/interactive/start
POST /api/calls/interactive/turn
POST /api/calls/:callId/end
```

The unparameterized lead list returns `{ leads }` for existing clients. Add `page`, `limit`, `search`, `industry`, or `scenario` for a paginated result. Calls can be filtered by `leadId`, `mode`, `kind`, `status`, and `outcome`. Appointments can be filtered by `leadId`, `status`, `from`, and `to`. New list responses include `pagination` with `page`, `limit`, `total`, and `totalPages`. Calendar dates use UTC.

The fixtures in `src/server/data` seed stable IDs once. The database preserves booked slots and deleted-lead markers across restarts. Legacy JSON logs remain on disk outside the MongoDB dataset. The summary `path` response field now points to its HTTP API URL.

## Call orchestration

### Deterministic mode (default)

`AGENT_MODE=deterministic` uses a small deterministic call flow for the main scenarios. It calls the
real CRM / calendar / summary tools and returns transcript bubbles, status events, tool calls, a
summary, and an outcome classification. It makes no LLM calls, so local demo work costs `$0`.

```text
POST /api/calls
```

```json
{ "leadId": "lead_interested" }
```

The public API deliberately uses the word "calls" rather than "simulations".

### LLM mode (optional, disabled by default)

```env
AGENT_MODE=llm
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
MAX_CALL_TURNS=8
MAX_OUTPUT_TOKENS=500
AGENT_MAX_MODEL_STEPS=4
AGENT_MAX_CALL_TOKENS=90000
AGENT_TURN_TIMEOUT_MS=20000
```

Scripted mode runs a repeatable lead scenario through the same OpenAI tool workflow used by live
interactive calls. The application validates all tool arguments and authorizes state changes.
Scripted discovery stays inside the simulated call. Live discovery can update CRM memory.

### Demo Mode vs Interactive Mode

- **Demo Mode** — the scripted flow. Uses the selected mock CRM lead and predefined lead replies to
  show a complete call quickly. Available for both deterministic and LLM agent modes.
- **Interactive Mode** — a live LLM flow. The agent opens the call, then the user types the lead
  reply or uses the Mic button. The frontend sends the lead ID, call ID, and latest reply. The
  backend uses the stored lead, transcript, and offered slots, with the submitted transcript length
  used to detect stale requests. The backend persists each turn and the final summary. Configured
  Vapi playback reads the agent reply while the transcript stays visible.

The Start Call button opens a minimal setup modal:

- Agent mode: `deterministic` or `llm`
- Call mode: `demo` or `interactive` (shown only when `llm` is selected)

Interactive Mode requires `OPENAI_API_KEY` and uses the same budget controls as LLM Demo Mode.

## Carla's prompt, memory and tools

The prompt in `src/server/agent/carlaSystemPrompt.ts` defines Carla's discovery, objection handling,
and call style. Each LLM turn receives recent persisted transcripts and verified CRM notes. OpenAI
returns structured intent, sentiment, objection and discovery signals. The backend computes qualification
and validates every action before persisting it. [OpenAI function calling documentation](https://developers.openai.com/api/docs/guides/function-calling)

Tools include `getLeadDetails`, `updateLead`, `searchKnowledgeBase`, `getAvailableSlots`,
`bookAppointment`, `classifyLead`, `saveCallSummary`, and `endCall`. Booking requires explicit
acceptance of a previous numbered offer, and it commits with the call result. Call details expose a
qualification breakdown. The score allocates 30 points for business need, 20 for decision authority,
20 for timeline, 15 for confirmed budget, and 15 for a confirmed appointment. A decline scores zero.

### Approved knowledge

The Knowledge Base sends PDF, DOCX, and TXT bytes to the backend. Files are stored under
`KNOWLEDGE_UPLOAD_DIR`, extracted, chunked, and indexed in MongoDB. Carla uses workspace-scoped
retrieval, quotes an approved excerpt, or offers human follow-up. By default retrieval is MongoDB
text search. Enable embeddings and configure an Atlas Vector Search index as described in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before calling retrieval semantic vector search.
The demo guide is seeded when `SEED_DEMO_DATA=true`.

```powershell
$form = @{ file = Get-Item .\product-guide.pdf }
Invoke-RestMethod http://localhost:3001/api/knowledge/documents/upload -Method Post -Form $form
```

Knowledge endpoints include `GET /api/knowledge/documents`, `GET /api/knowledge/documents/:id`,
`DELETE /api/knowledge/documents/:id`, `POST /api/knowledge/documents/:id/reprocess`, and
`GET /api/knowledge/search?q=...`. There is one server-controlled local workspace; this is not
multi-tenant authentication.

## Two-minute demo

1. `npm run dev`
2. Open the Live Call Demo screen at `http://localhost:5173`.
3. Choose a lead.
4. Click **Start call**.
5. No-cost complete flow — Agent mode: `deterministic`.
6. LLM scripted flow — Agent mode: `llm`, Call mode: `demo`.
7. Manual lead conversation — Agent mode: `llm`, Call mode: `interactive`.
8. In Interactive Mode, try:
   - `Can we book a meeting?`
   - `Option 1 works`
   - `We already use Salesforce.`
   - `Budget is tight.`
   - `Send me an email.`

When a meeting is booked, the backend calls the calendar and booking tools, saves the call summary,
and the UI ends the call with a booked outcome.

## Vapi voice layer

Vapi is integrated with the official `@vapi-ai/server-sdk` as a **voice transport layer**, not as
the agent brain. The source of truth stays in this backend: lead context, conversation history, the
agent prompt, tool calling, summary, and classification. Vapi handles only speech-to-text input,
text-to-speech output, call transport, and webhook/tool events forwarded into this backend.

Keep the Vapi dashboard assistant prompt minimal:

```text
You are Carla, an AI SDR. Follow the backend-provided conversation instructions and use the configured tools. Keep responses concise, natural, and professional.
```

Do not duplicate the full agent prompt or tool logic in the Vapi dashboard.

Vapi endpoints:

```text
GET  /api/vapi/config
POST /api/vapi/calls
POST /api/vapi/webhook
POST /api/vapi/chat/completions
POST /api/vapi/turn
```

`POST /api/vapi/calls` accepts:

```json
{
  "leadId": "lead_interested",
  "customerNumber": "+15551234567"
}
```

By default, Vapi call creation runs in dry-run mode. No paid outbound call is created unless
`VAPI_ALLOW_OUTBOUND_CALLS=true`.

```env
VAPI_API_KEY=your_vapi_key_here
VAPI_PUBLIC_BASE_URL=https://your-public-backend-url.example
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
VAPI_ASSISTANT_ID=your_minimal_vapi_assistant_id
VAPI_ALLOW_OUTBOUND_CALLS=false
VAPI_MAX_OUTBOUND_CALLS=2
VAPI_MAX_CALL_DURATION_SECONDS=300
```

- `VAPI_ALLOW_OUTBOUND_CALLS=false` keeps local development safe by returning a planned call instead
  of creating a paid outbound call.
- `VAPI_MAX_OUTBOUND_CALLS=2` limits real Vapi outbound calls per server process.
- `VAPI_MAX_CALL_DURATION_SECONDS=300` caps the outbound call duration.

`POST /api/vapi/chat/completions`, `/api/vapi/webhook`, and `/api/vapi/turn` require the
`Authorization: Bearer <VAPI_SHARED_SECRET>` credential; if `VAPI_SHARED_SECRET` is missing these
routes return a configuration error. Configure the matching Bearer credential in Vapi. The
`VAPI_SERVER_CREDENTIAL_ID` is used when backend-created outbound calls attach a webhook override.
Real outbound requests use the stored lead `phoneNumber`; a request number must match it.

The Live Call Demo, Demo Mode, and Interactive Text Mode remain fully usable without Vapi.

`POST /api/vapi/chat/completions` is the Vapi Custom LLM endpoint. Its response is a JSON
`chat.completion`; SSE streaming is not implemented. Configure the Vapi assistant model as a custom
/ OpenAI-compatible server pointing at
`{VAPI_PUBLIC_BASE_URL}/api/vapi/chat/completions`. The backend uses `OPENAI_MODEL` and
`MAX_OUTPUT_TOKENS`, not Vapi's request model/temperature/token fields. Vapi requests must include
`call.metadata.leadId` or `metadata.leadId` so the backend can load the correct mock CRM lead and
keep the existing orchestration as the agent brain.

`POST /api/vapi/turn` is a lower-level bridge for finalized voice transcripts. It accepts `leadId`,
`callId`, `transcript`, and `leadReply`, then forwards that turn into the same backend orchestration
used by Interactive Mode. The response includes the agent's next message for Vapi to speak.

Real outbound calls use the configured `VAPI_ASSISTANT_ID` for STT, TTS, and transport. The Custom LLM adapter restores the stored voice session. End-of-call reports finalize known voice calls from the stored transcript. Verify the provider configuration before enabling outbound calls.

## Budget controls

Development defaults to deterministic mode, so local demo work costs `$0`. LLM mode should only be
enabled intentionally with `AGENT_MODE=llm` and a real `OPENAI_API_KEY`.

`MAX_CALL_TURNS` and `MAX_INTERACTIVE_LEAD_TURNS` cap scripted and interactive turns.
`MAX_OUTPUT_TOKENS` caps each model response and is bounded at 800. `AGENT_MAX_MODEL_STEPS` limits
model requests per turn. `AGENT_MAX_CALL_TOKENS` budgets a whole call using reported usage and a
conservative estimate before each request. `AGENT_TURN_TIMEOUT_MS` bounds each model turn.

## Secrets

Real API keys belong in `.env`. Commit `.env.example`, never `.env`.
