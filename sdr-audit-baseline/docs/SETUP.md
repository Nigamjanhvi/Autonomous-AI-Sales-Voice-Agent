# Local setup

For the full Hinglish walkthrough, feature checks, Vapi browser voice steps and troubleshooting, see
[USER_GUIDE_HINGLISH.md](USER_GUIDE_HINGLISH.md).

## Requirements

- Node.js 22.12 or newer and npm.
- MongoDB Atlas or a local MongoDB replica set. Transactions used by bookings/calls require a
  replica set or sharded cluster.
- OpenAI API key only for LLM calls or optional embeddings. Vapi credentials only for voice calls.

## Install and configure

From `sdr-audit-baseline`:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Set `MONGODB_URI`, `MONGODB_DB`, and `SEED_DEMO_DATA` in `.env`. Atlas connection instructions:
[Connect to an Atlas cluster](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).
Keep `.env` private; only safe placeholders belong in `.env.example`.

Optional RAG variables:

```env
DEFAULT_WORKSPACE_ID=workspace_default
KNOWLEDGE_UPLOAD_DIR=uploads/knowledge
RAG_EMBEDDINGS_ENABLED=false
MONGODB_VECTOR_INDEX=knowledge_chunks_vector
RAG_CHUNK_CHARS=3200
RAG_CHUNK_OVERLAP_CHARS=480
```

For vector search, provide a valid `OPENAI_API_KEY`, set `RAG_EMBEDDINGS_ENABLED=true`, and create
the Atlas index exactly as shown in [ARCHITECTURE.md](ARCHITECTURE.md). Keys are backend-only; do
not use a `VITE_` prefix. For LLM calls set `AGENT_MODE=llm`, `OPENAI_API_KEY`, and optionally
`OPENAI_MODEL`. Deterministic mode is the default.

## Start

```powershell
npm.cmd run dev
```

This runs Express on `http://localhost:3001` and Vite on `http://localhost:5173`. To run separately,
use `npm.cmd run dev:server` and `npm.cmd run dev:client`. Database readiness is available at
`http://localhost:3001/health/db`.

## Credentials and optional integrations

- MongoDB Atlas: database user/connection URI from the Atlas project.
- OpenAI: API key from the OpenAI developer platform. Required for LLM mode and optional embeddings.
- Vapi: public browser key and assistant ID for browser voice; server API key and shared secret for
  provider calls/webhooks. Vapi needs a reachable HTTPS backend for callbacks. Outbound calling
  remains disabled unless explicitly configured. No real Vapi call was tested here.

Atlas credentials and API keys are external configuration. Atlas vector index setup is manual;
without it, the app stays usable with clearly labeled MongoDB text search.

## Carla Vapi v3 local testing with ngrok

The owner reports Carla assistant v3 is published with 100% traffic and has configured the Custom
LLM and webhook URLs. This state is not independently verifiable from repository files. Exact
endpoint roles, `.env` variable meanings, the reported Vapi settings, and the tested/not-verified
status are documented in [README.md](../README.md#current-vapi-setup-v3-as-reported) and
[USER_GUIDE_HINGLISH.md](USER_GUIDE_HINGLISH.md).

Vapi Custom LLM requests go to `POST /api/vapi/chat/completions`. The Assistant Server URL event
handler is separate: `POST /api/vapi/webhook`, currently used for `end-of-call-report` finalization.
Both require `Authorization: Bearer <VAPI_SHARED_SECRET>`. Use the same ngrok HTTPS domain in the
Vapi URLs and `VAPI_PUBLIC_BASE_URL`.

Run the terminals from `sdr-audit-baseline`:

```powershell
# Terminal 1: backend
npm.cmd run dev:server
```

```powershell
# Terminal 2: frontend
npm.cmd run dev:client
```

```powershell
# Terminal 3: ngrok CLI (external to npm/package.json)
ngrok http 3001
```

Or replace the first two commands with `npm.cmd run dev` in one terminal; keep ngrok in another.
The Vapi app needs the public HTTPS forwarding URL because it cannot reach a local loopback address.
When the tunnel URL changes, update the Custom LLM base URL, Assistant Server URL, and
`VAPI_PUBLIC_BASE_URL`, then restart the app.

The Vapi UI reports Custom LLM model `gpt-4.1-mini`, temperature `0.5`, and maximum tokens `250`.
The server code actually selects `OPENAI_MODEL` and `MAX_OUTPUT_TOKENS`; it does not pass through
Vapi's model/temperature/token request settings. Set the backend model/token environment variables
to align supported fields; backend temperature is not currently configurable. The route returns
normal JSON, not an SSE stream.

For the actual call test: open `http://localhost:5173` → **Live Calls** → select a lead → **Start
call** → **Vapi Live Voice** → allow microphone → speak → end call → verify Call History and
`GET /api/calls`. A Vapi/live ngrok connection and end-of-call webhook have not been verified by
the automated integration suite. That suite exercises the backend with a test credential and model
stub only.
