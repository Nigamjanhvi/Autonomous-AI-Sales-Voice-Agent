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

## Phase 4 browser voice setup

The **Vapi Live Voice** call mode uses browser audio. Vapi transports speech and sends each Custom LLM request to Carla in Express; Carla's reasoning, tools, and MongoDB writes remain on the backend. This mode is separate from the older text-interactive mode and its optional muted Vapi playback.

1. Configure MongoDB and `OPENAI_API_KEY` in the ignored `.env`. Start both servers with `npm.cmd run dev`.
2. Make the backend reachable from Vapi over HTTPS. Set `VAPI_PUBLIC_BASE_URL` to that public base URL. A localhost URL cannot receive Vapi server requests.
3. In Vapi, create a voice assistant with its model provider set to **Custom LLM**. Point the Custom LLM URL to `https://YOUR-BACKEND/api/vapi/chat/completions`. Keep the assistant's system prompt minimal; Carla's full prompt and tools run in Express. Set the assistant language/transcriber for English and Hindi if your selected Vapi providers support both.
4. Create a Vapi server credential whose `Authorization` header is `Bearer YOUR_RANDOM_SECRET`. Set `VAPI_SHARED_SECRET` to that same secret in `.env`. Configure that credential for the Custom LLM URL and the assistant's server URL, `https://YOUR-BACKEND/api/vapi/webhook`. The backend checks that header. Do not expose the secret to the browser.
5. Set `VITE_VAPI_PUBLIC_KEY` and `VITE_VAPI_ASSISTANT_ID` in `.env`. The public key is designed for browser use; never use `VAPI_API_KEY` or `OPENAI_API_KEY` with a `VITE_` prefix. Optionally set `VITE_VAPI_MAX_CALL_DURATION_SECONDS` (30–900, default 300).
6. Open Live Calls, choose a lead, select **Vapi Live Voice**, and click **Start browser call**. Allow microphone access. The UI reports a connection only after Vapi's `call-start` event. Test a short English conversation, then a Hindi one. Verify the final transcript and summary through `GET /api/calls/:callId` and Call History. Mute/unmute, interruption, end, and permission denial are available in this screen.

Outbound calling stays disabled until `VAPI_ALLOW_OUTBOUND_CALLS=true`. After browser voice is verified, use a number you own or have permission to call. Set the selected lead's real test number in MongoDB, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`, `VAPI_API_KEY`, `VAPI_SERVER_CREDENTIAL_ID`, and the public HTTPS URL. Set a low `VAPI_MAX_OUTBOUND_CALLS` and `VAPI_MAX_CALL_DURATION_SECONDS`. The outbound endpoint uses the lead's stored number; it does not trust a different number supplied in the request. `POST /api/vapi/calls` creates the provider request only when explicitly enabled. A created provider call is not evidence of a connected call; inspect provider events and the persisted call record.

The automated suite uses a local MongoDB replica set and a model stub. Live Vapi browser audio, provider callbacks, and real outbound dialing require configured provider credentials and an authorized test number.

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

When `VAPI_SHARED_SECRET` is configured, send it as a Bearer credential on provider callbacks and the turn bridge. Real outbound requests also require it. Configure the corresponding credential in Vapi and optionally set `VAPI_SERVER_CREDENTIAL_ID` when supplying a webhook URL override. Real calls use the stored lead `phoneNumber`. Any request number must match the stored value.

The Live Call Demo, Demo Mode, and Interactive Text Mode remain fully usable without Vapi.

`POST /api/vapi/chat/completions` is the preferred Vapi Custom LLM endpoint. Configure the Vapi
assistant model as a custom / OpenAI-compatible server pointing at
`{VAPI_PUBLIC_BASE_URL}/api/vapi/chat/completions`. Vapi requests must include
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
