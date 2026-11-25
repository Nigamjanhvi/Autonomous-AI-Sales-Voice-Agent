# Autonomous AI Sales Voice Agent

This is the running project record for the Fortivex AI technical evaluation. Update the current phase, decisions, verification evidence, and next approval gate here at each phase.

## Current phase

| Item | Status |
|---|---|
| Current phase | **Phase 4 browser voice implementation complete; user-reported Vapi v3 configuration published; live provider verification pending** |
| Verification | November 26, 2026: ten integration tests passed with a local MongoDB replica set and an OpenAI-compatible stub; TypeScript/Vite build and Oxlint passed. Vapi route/auth and synthetic webhook behavior are test-fixture checks, not a live Vapi or ngrok test. |
| Evaluation repository | [Nigamjanhvi/Autonomous-AI-Sales-Voice-Agent](https://github.com/Nigamjanhvi/Autonomous-AI-Sales-Voice-Agent), with the application under `sdr-audit-baseline/` |
| Approved baseline | [Dekelbo/SDR_CallingAgent at `0b2dcf53213cda4a7e2dc4b219d4532c4d303cd2`](https://github.com/Dekelbo/SDR_CallingAgent/tree/0b2dcf53213cda4a7e2dc4b219d4532c4d303cd2), audited in Phase 0 |
| Working source | The dashboard, MongoDB persistence, and Carla’s backend-controlled agent run from the application folder. |
| Reuse | The baseline has no tracked license file and declares `UNLICENSED`. Confirm reuse permission before publishing its code or assets to the evaluation repository. |

## Project purpose

Carla is an AI sales development representative. The project demonstrates a permission-based outbound conversation, CRM-informed discovery, objection handling, meeting scheduling, and post-call classification. The current evaluation baseline uses mock CRM and calendar data. Email, invites, and callbacks are recorded as recommended actions. Optional Vapi paths provide browser audio and an outbound dialing adapter.

## Technology stack and architecture

| Layer | Current implementation |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, and CSS. Responsive dashboard shell with eight views and a lazy-loaded live call console. |
| Backend | Node.js, Express 5, TypeScript, `tsx`, dotenv, Zod, and CORS. The default API port is 3001. Vite normally serves the UI on 5173. |
| AI | OpenAI SDK 6, Chat Completions with strict function calling and structured final replies, Zod, bounded conversation context, and configurable `gpt-4.1-mini` default. |
| Voice | Browser `SpeechRecognition` for interactive lead input, `@vapi-ai/web` for optional agent playback, and `@vapi-ai/server-sdk` for planned or real outbound calls. |
| Storage | Mongoose 9 and MongoDB Atlas or a local replica set. JSON fixtures are optional seed inputs. The dashboard still captures browser-local call history and preferences in localStorage and files in IndexedDB. |
| Verification | TypeScript, Vite, Oxlint, and Node's integration test runner. The suite uses a disposable replica set and a local model stub. |

The browser fetches the agent profile and CRM leads from Express. Express routes delegate to deterministic or LLM orchestration. The orchestrators and direct HTTP endpoints share backend tools for CRM lookup, calendar checks, mock bookings, summary persistence, and classification. The frontend reads `VITE_API_BASE_URL` and defaults to `http://localhost:3001`. Set it to `/` for same-origin API routing. Vite builds browser assets and Express starts separately from TypeScript.

## Repository map

```text
sdr-audit-baseline/
├── .env.example, .gitignore, .oxlintrc.json
├── README.md, index.html, package.json, package-lock.json
├── tsconfig.json, tsconfig.app.json, tsconfig.node.json, vite.config.ts
├── public/                    Carla portrait, favicon, icon sprite
└── src/
    ├── App.tsx, App.css, index.css, main.tsx
    ├── dashboard/             Dashboard views, live console, data model, reusable UI
    ├── assets/                Starter React/Vite assets
    └── server/
        ├── app.ts, index.ts, types.ts
        ├── agent/             Carla's prompt and LLM orchestration
        ├── calls/             Mode selection and deterministic scenarios
        ├── config/            Carla's profile
        ├── controllers/       Lead HTTP controllers
        ├── data/              Optional demo seed inputs
        ├── db/                MongoDB connection, schemas, indexes, demo seeding
        ├── http/              Zod request validation and error mapping
        ├── routes/            Lead, call, tool, and Vapi endpoints
        ├── services/          Lead, appointment, and call persistence
        ├── tools/             Lead, calendar, booking, summary, outcome
        └── vapi/              Voice service and provider adapters
```

Phase 0 recorded 42 baseline files. Legacy files under `logs/` are outside runtime storage in Phase 2. The optional fixture inputs remain in the repo. Phase 1 imports backend types as type-only dependencies, and Phase 2 uses Zod for HTTP and model outputs.

## Phase 4 — Real-time voice work

The Live Calls screen now offers **Vapi Live Voice** as a separate mode. It requests microphone access, starts the Vapi web SDK with the selected lead ID, waits for the provider's `call-start` event before showing connected, displays confirmed transcript segments, measures connected duration, and supports mute, interruption, end, connection errors, and a configurable browser duration cap. Vapi Custom LLM requests continue through Express and the Phase 3 Carla orchestrator; MongoDB stores the conversation, tools, and summary. The Custom LLM adapter requires a provider call ID and skips a repeated final lead transcript. The Carla prompt now permits concise English or Hindi based on the lead's language.

The owner reports Carla assistant v3 published at 100% traffic (v2 at 0%). Reported Custom LLM settings are provider `Custom LLM`, model label `gpt-4.1-mini`, base URL `https://YOUR_NGROK_DOMAIN/api/vapi`, suffix `/chat/completions`, temperature 0.5, and maximum tokens 250. The resolved route is `POST /api/vapi/chat/completions`. The separately reported Assistant Server URL is `POST https://YOUR_NGROK_DOMAIN/api/vapi/webhook`, using the `Carla Backend Auth` Bearer credential and a 20-second timeout. These dashboard settings are owner-reported and have not been independently inspected or live-tested.

For local testing, ngrok must expose backend port 3001 over HTTPS because Vapi cannot reach laptop localhost. The package scripts are `npm.cmd run dev:server`, `npm.cmd run dev:client`, or combined `npm.cmd run dev`; the external ngrok CLI command is `ngrok http 3001`. Keep the same current ngrok host in `VAPI_PUBLIC_BASE_URL`, the Custom LLM base URL, and the Assistant Server URL. See [detailed setup](sdr-audit-baseline/README.md#current-vapi-setup-v3-as-reported) and the [Hinglish walkthrough](sdr-audit-baseline/docs/USER_GUIDE_HINGLISH.md).

Source check: the Custom LLM route returns a regular JSON completion, not SSE streaming, and Carla's backend uses `OPENAI_MODEL` / `MAX_OUTPUT_TOKENS`; Vapi model/temperature/token fields are not forwarded. The webhook handler only finalizes known active calls on `end-of-call-report`; it does not implement call-started, status-update, or transcript event handlers. Both routes require Bearer auth via `VAPI_SHARED_SECRET`. Automated tests verify route behavior with a test credential/model stub; live browser audio, current ngrok forwarding, actual webhook delivery, and outbound dialing remain unverified. Keep outbound disabled by default.

## Phase 3 — Carla autonomous agent

Carla's workflow remains inside Express for scripted, interactive, and Vapi Custom LLM requests. The backend loads the lead, a bounded window of the persisted transcript, verified discovery, and the previous numbered calendar offers. OpenAI can request typed tools one at a time and returns a structured reply with intent, sentiment, objection, and evidence. The backend applies action policies, computes lead qualification, and commits the resulting call state. [OpenAI function calling documentation](https://developers.openai.com/api/docs/guides/function-calling)

| Area | Phase 3 behavior |
|---|---|
| Conversation | Carla introduces herself as an AI, asks permission, acknowledges the lead’s concerns, and uses concise replies with at most one question. The reply handler checks for repeated text and uses a clarification prompt when appropriate. |
| Memory | MongoDB stores the complete transcript, summary, analysis, and opt-out status. Later live calls load CRM discovery from earlier calls. Scripted evidence stays inside the simulated call. |
| Intent and sentiment | Structured output separates interest, confusion, product questions, objections, scheduling, callback, follow-up email, decline, and disqualification. Sentiment is positive, neutral, or negative. |
| Discovery | Only excerpts verified against the latest lead reply can be saved through `updateLead`. Discovery adds notes and preserves the canonical lead ID, contact information, and ownership fields. |
| Qualification | Evidence rubric allocates 30 points for a business need, 20 for decision authority, 20 for a stated timeline, 15 for confirmed budget, and 15 for a confirmed appointment. A decline zeroes the score. The default backend threshold is 60. Call History shows the points and evidence. |
| Grounding | `POST /api/knowledge/documents` accepts a title and approved plain text. MongoDB indexes the resulting chunks. The demo seeds an evaluation guide. A product answer uses a verified excerpt or offers a human follow-up. Browser-local files stay separate from this index. |
| Scheduling and close | Availability requires an explicit scheduling request. Booking requires consent to an exact previous option. A declined or unavailable option can never be silently replaced. The backend records the outcome and next action and persists explicit opt-outs to block future calls. |
| Failure handling | Model timeout and invalid responses produce retryable sanitized errors. Proposed CRM and booking actions stage until the transaction commits. Tool logs carry a hashed trace identifier, tool name, result code, and duration. |
| Usage controls | `MAX_CALL_TURNS`, `MAX_INTERACTIVE_LEAD_TURNS`, `MAX_OUTPUT_TOKENS`, `AGENT_MAX_MODEL_STEPS`, `AGENT_MAX_CALL_TOKENS`, and `AGENT_TURN_TIMEOUT_MS` bound model usage and interaction duration. Active sessions record failed model attempts against their budget without appending a transcript message. Predefined mode remains available with MongoDB alone. |

The integration suite covers a qualified interested lead, a confused reply, a budget objection, unsupported and grounded product questions, and a customer who declines and opts out. It also checks strict schemas, timed-out and failed model requests, exact appointment selection, and persisted memory. Run `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run lint` from the application folder. Live OpenAI, hosted Atlas and live Vapi are outside the local verification. [Sales scenario tests](sdr-audit-baseline/tests/api.integration.test.ts)

The Phase 3 backend adds [model orchestration](sdr-audit-baseline/src/server/agent/carlaModel.ts), [tool dispatch](sdr-audit-baseline/src/server/agent/carlaTools.ts), [call policy](sdr-audit-baseline/src/server/agent/carlaPolicy.ts), [turn processing](sdr-audit-baseline/src/server/agent/carlaTurn.ts), and [knowledge indexing](sdr-audit-baseline/src/server/services/knowledge.ts). It updates the existing prompts, call orchestration, MongoDB schema and persistence, Vapi adapter, dashboard reporting, environment example, README, and integration tests.

## Phase 2 MongoDB backend

| Area | Behavior delivered in Phase 2 |
|---|---|
| Connection | `MONGODB_URI` configures Atlas or a local replica set. `MONGODB_DB` overrides the URI database when supplied. Startup verifies replica-set or sharded topology and creates declared indexes. `/health/db` pings MongoDB, and `/health` retains its response shape. |
| Collections | Users, leads, calls, conversations, summaries, appointments, knowledge documents, knowledge chunks, and agent configuration. Unique indexes protect stable identifiers, summary and conversation ownership by call, and one appointment per call. Additional indexes support common list filters and chronological queries. |
| Leads | CRUD uses server-generated IDs and soft deletion, so historical call snapshots remain available. The original unparameterized list retains `{ leads }`. Filtered and paginated requests include metadata. |
| Calls and summaries | Completed demos and each interactive turn store metadata, ordered messages, summary, and outcome. Interactive replies are bound to the stored lead and transcript. The API exposes history and detail, and the dashboard's manual end now finalizes the persisted call. |
| Booking | The backend records offered slot IDs and reserves only the accepted option. Call records, summary and transcript, and any booking commit together. Availability excludes past, held, and booked slots. Exhaustion remains authoritative after restart. |
| Validation and access | Zod guards request bodies, identifiers, list parameters, and model outputs. Error responses use sanitized messages and stable codes. Vapi Bearer authentication is configurable and required for real outbound requests. Real dialing uses the lead's stored phone number. The app is single-tenant and binds to loopback by default. |
| Scope | The User schema has no dedicated API. Phase 3 added plain-text knowledge ingestion through `POST /api/knowledge/documents`; dashboard file uploads remain browser-local and do not feed that endpoint. The default Agent Configuration supplies the profile endpoint. The dashboard still reads history and appointments from the browser record of calls it performed. Legacy JSON logs are retained separately and have not been imported into MongoDB. |

### Phase 2 setup and verification

From the workspace root, enter `sdr-audit-baseline/`, run `npm.cmd ci`, then copy `.env.example` to the ignored `.env` if one does not exist. Configure `MONGODB_URI`, the optional `MONGODB_DB` database override, and `SEED_DEMO_DATA`. The demo seed writes the initial leads and forward-dated slots once. Set `CLIENT_ORIGIN` if using a different frontend origin. Start with `npm.cmd run dev` and check `GET /health/db`. [Local replica-set and Atlas instructions](sdr-audit-baseline/README.md) · [Atlas connection setup](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/)

`npm.cmd test` starts a disposable local replica set when `mongod` is on PATH. Use `MONGOD_BINARY` for a custom executable path or `MONGODB_TEST_URI` for a dedicated external test deployment. The suite verifies database readiness, lead CRUD and pagination, all eight deterministic scenarios, persisted interactive turns and provider session binding, Vapi dry-run and webhook behavior, concurrent reservations, exact slot selection, and persistence across two API restarts. OpenAI uses a local stub for the tests. [Integration tests](sdr-audit-baseline/tests/api.integration.test.ts)

Before exposing the backend to shared users, add authentication and derive tenant scope from the authenticated identity in every repository query. Live Atlas validation requires a configured cluster connection, and live audio and dialing require a configured provider.

### Phase 2 changed files

Paths are relative to `sdr-audit-baseline/` except for this project record.

- **Configuration and setup** — `.env.example`, `.gitignore`, `README.md`, `package.json`, `package-lock.json`, and `tsconfig.node.json`.
- **MongoDB and services** — `src/server/db/connection.ts`, `src/server/db/models.ts`, `src/server/services/leads.ts`, `src/server/services/calls.ts`, and `src/server/services/appointments.ts`. Replaced `src/server/storage/jsonStore.ts`.
- **Express and contracts** — `src/server/app.ts`, `src/server/index.ts`, `src/server/http/errors.ts`, `src/server/http/validation.ts`, `src/server/controllers/leads.ts`, `src/server/routes/leads.ts`, `src/server/routes/calls.ts`, `src/server/routes/tools.ts`, `src/server/routes/vapi.ts`, and `src/server/types.ts`.
- **Call workflows** — `src/server/calls/callOrchestrator.ts`, `src/server/agent/llmCallOrchestrator.ts`, `src/server/tools/getLeadContext.ts`, `src/server/tools/checkCalendarAvailability.ts`, `src/server/tools/bookMeeting.ts`, `src/server/tools/saveCallSummary.ts`, `src/server/vapi/vapiVoiceService.ts`, and `src/dashboard/LiveCalls.tsx`.
- **Tests** — `tests/api.integration.test.ts` and `tests/mongoFixture.ts`.
- **Phase record** — `PROJECT.md` at the workspace root.

## Phase 1 dashboard

| View | Behavior and data |
|---|---|
| Overview | Counts CRM leads from the API and computes activity, qualification, bookings, and conversion from calls captured in this browser. Displays recent activity, a unique-lead funnel, and estimated sentiment. |
| Live Calls | Retains Predefined, AI (Scripted), and AI (Interactive), the existing API flow, browser microphone, and optional Vapi playback. Adds a call timer, responsive console, transcript, lead details, recent tools, and outcome. Navigation keeps the active console mounted so playback can continue. |
| Leads | Displays the CRM fixture from Express, with search, status and industry filters, call-based scores, and a detail drawer. The drawer passes the selected lead into Live Calls. Leads without call evidence remain unscored. |
| Call History | Captures completed and manually ended calls in this browser. Search and outcome filters open a drawer with the actual transcript, backend summary, disposition, and locally estimated sentiment. Earlier server logs are outside this view because the backend has no read endpoint for them. |
| Knowledge Base | Adds files by selection or drag and drop, with status, download, and removal. IndexedDB stores PDF, DOCX, TXT, Markdown, and CSV files up to 10 MB each. Files are browser-local and Carla’s backend does not index them. |
| Appointments | Shows calendar days, upcoming meetings, and past bookings from confirmed booking tool results captured in this browser. The backend currently offers older fixture dates, which appear under past bookings. |
| Analytics | Filters recorded calls by time range and reports outcomes, duration, lead conversion, sentiment, and appointment conversion. Duration includes browser demo playback. |
| Agent Settings | Persists display name, a personality note, microphone language, Vapi or text-only playback, and qualification criteria. The profile fields affect the workspace display. The actual Carla prompt and voice configuration remain on the backend and in Vapi. |

Phase 1 source includes [the navigation and shared workspace state](sdr-audit-baseline/src/App.tsx), [the live call console](sdr-audit-baseline/src/dashboard/LiveCalls.tsx), [the reporting views](sdr-audit-baseline/src/dashboard/Reporting.tsx), [the lead directory](sdr-audit-baseline/src/dashboard/Leads.tsx), [the workspace views](sdr-audit-baseline/src/dashboard/WorkspaceViews.tsx), [frontend data and reporting helpers](sdr-audit-baseline/src/dashboard/model.ts), and [shared UI components](sdr-audit-baseline/src/dashboard/ui.tsx). The project gained no package dependencies.

Overview conversion is distinct CRM leads with a booked meeting divided by total CRM leads. Analytics appointment conversion is booked calls divided by calls in the selected period. Predefined and older call records use the Phase 1 scoring and sentiment heuristics. Phase 3 AI calls supply evidenced qualification and sentiment through their stored analysis.

### Phase 1 verification

- `npm.cmd run build` passed TypeScript and the Vite production build. The initial JavaScript bundle was 234.61 kB and the lazy-loaded Live Calls bundle was 311.08 kB before compression.
- `npm.cmd run lint` and `git diff --check` passed. No backend or package files changed.
- Chrome verified all eight screens at desktop, tablet, and phone widths. It exercised CRM search and drawer handoff, deterministic call timers and transcripts, history, calendar bookings, metrics, document upload/download/removal, settings persistence, and API failure and retry. A separate mobile-emulation test checked all eight routes for page overflow.
- A separate browser test ran AI Scripted and AI Interactive with a local OpenAI-compatible stub. It verified typed replies, background navigation during an active call, the backend turn limit, and manual end appearing in history. Live microphone capture, OpenAI responses, Vapi audio, and outbound calls were outside this verification.

## Call workflows

### Predefined

1. The user selects a lead and **Predefined**. The browser sends `leadId` and `mode: "deterministic"` to `POST /api/calls`.
2. The backend loads CRM context and runs the relevant scenario without model calls. The interested scenario checks availability, adds scripted acceptance, and writes a mock booking.
3. The backend classifies the result and saves the summary and full call. The browser replays transcript bubbles and displays the tool signals and outcome. Backend writes happen before browser playback.

### AI (Scripted)

1. The browser calls the same endpoint with `mode: "llm"`.
2. OpenAI runs the same structured function-calling workflow used for interactive calls. The lead follows a fixture, and the backend validates every tool action.
3. The interested fixture explicitly accepts an offered option. The backend saves the result. The browser replays the transcript and can use Vapi for playback when configured.

### AI (Interactive)

1. The browser starts an LLM call and receives Carla's opening. The user types a reply or captures it through the browser microphone using the configured input language.
2. The browser sends the call ID, lead ID, transcript, and latest reply. The backend classifies intent, checks scheduling rules, and returns a tool-backed or model-generated reply. The browser can play agent text through a separate muted Vapi session using `vapi.say`.
3. The backend persists the conversation and summary on every turn. Booking, the scheduling-email branch, opt-out handling, manual end, and the turn limit finalize the stored call. The dashboard captures a local history entry using the API result.

### Vapi outbound and webhooks

`POST /api/vapi/calls` defaults to dry run. Real dialing requires explicit opt-in, a server key, an assistant ID, a phone number ID, the lead's persisted phone number, and a Bearer credential. `/api/vapi/chat/completions` and `/api/vapi/turn` resolve the stored conversation and verify the lead binding. `/api/vapi/webhook` finalizes known active voice calls on an end-of-call report. Dry run, transport authentication, and session finalization passed against synthetic callbacks. Live audio, streaming negotiation, and outbound dialing still require provider verification. [Vapi server events](https://docs.vapi.ai/server-url/events) · [Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication)

## Carla's prompt and backend tools

[Carla's prompt](sdr-audit-baseline/src/server/agent/carlaSystemPrompt.ts) defines identity, permission-based discovery, concise pitching, objection handling, and opt-out behavior. It calls for CRM context before personalization and explicit acceptance of an available time before booking. It prohibits invented CRM data, availability, product features, pricing, and guarantees. Deterministic mode uses its own scripted dialogue.

| Tool | Behavior |
|---|---|
| `getLeadDetails` | Supplies scoped CRM context for the current lead. |
| `updateLead` | Stages verified discovery evidence from the latest lead reply. |
| `searchKnowledgeBase` | Retrieves approved, indexed company passages. |
| `getAvailableSlots` | Offers up to two future slots after an explicit scheduling request. |
| `bookAppointment` | Stages the exact accepted slot for transactional reservation. |
| `classifyLead` | Computes the backend qualification score and evidence breakdown. |
| `saveCallSummary` | Queues the generated summary. The backend writes the final record and its resource path. |
| `endCall` | Stages a permitted close. The application persists the terminal state and next action. |

## API inventory

| Method and route | Purpose |
|---|---|
| `GET /health` | Backend health |
| `GET /health/db` | MongoDB readiness |
| `GET /api/agent` | Carla's profile |
| `GET /api/leads` | CRM lead list |
| `GET /api/leads/:leadId` | One CRM lead |
| `POST /api/leads` | Creates a lead with a server-generated ID |
| `PATCH /api/leads/:leadId` | Updates lead fields |
| `DELETE /api/leads/:leadId` | Archives the lead and retains history |
| `GET /api/calendar/availability` | Availability, optionally with `preferredDate` |
| `POST /api/meetings` | Mock booking from `leadId`, `slotId`, and optional `notes` |
| `GET /api/appointments` | Paginated appointment records with optional status, lead, and date filters |
| `POST /api/call-summaries` | Writes a submitted summary |
| `POST /api/knowledge/documents` | Indexes approved plain-text knowledge for Carla |
| `GET /api/call-summaries/:summaryId` | Retrieves a persisted summary and outcome |
| `POST /api/lead-outcomes/classify` | Classifies a transcript and optional summary |
| `POST /api/calls` | Complete deterministic or scripted LLM demo |
| `GET /api/calls` | Paginated call metadata with optional lead, channel, mode, outcome, and status filters |
| `GET /api/calls/:callId` | Retrieves call metadata, transcript, and summary |
| `POST /api/calls/interactive/start` | Generates an opening for `leadId` and `mode: "llm"` |
| `POST /api/calls/interactive/turn` | Uses `leadId`, optional `callId`, `transcript`, and `leadReply` |
| `POST /api/calls/:callId/end` | Finalizes an active browser interactive call |
| `GET /api/vapi/config` | Vapi configuration and process-local call budget |
| `POST /api/vapi/calls` | Planned or real outbound call |
| `POST /api/vapi/webhook` | Acknowledges the event and finalizes known voice calls on end-of-call reports |
| `POST /api/vapi/chat/completions` | Maps Vapi messages and lead metadata to an interactive turn |
| `POST /api/vapi/turn` | Direct transcript bridge returning Carla's latest reply |

## Phase 0 verification and observed outcomes

| Check | Phase 0 evidence |
|---|---|
| Install and build | Locked dependencies installed. TypeScript passed for frontend and backend. Vite built successfully with a 501 kB chunk warning. |
| Lint | Exit code 0 with two React effect dependency warnings tied to Vapi. |
| Browser | Headless Chrome showed eight leads, Carla, all three mode choices, five busy-call transcript entries, and **Call Back Later**. |
| Deterministic API | All eight scenarios completed. Each saved a call and summary. Interested wrote a mock booking. |
| AI API | Scripted LLM, interactive start and turn, and both Vapi model adapters ran against a local OpenAI-compatible stub. Missing-key behavior was verified. |
| Vapi dry run | Config and planned call worked with outbound disabled. The webhook acknowledged a synthetic end-of-call report. |
| Live providers | Live OpenAI behavior, microphone input, Vapi audio, and real dialing remain unverified. The audit used neither credentials nor paid calls. |
| npm advisories | Registry audit found 10 affected package entries, including 2 critical, 7 high, and 1 moderate. Reachability was outside the runtime tests. |

| Lead scenario | Observed classification |
|---|---|
| Interested | `meeting_booked` |
| Busy | `call_back_later` |
| Declined | `not_interested` |
| Budget objection, email request, authority objection | `send_email` |
| Existing CRM, security concern | `needs_human_follow_up` |

## Known issues and required changes

| Area | Finding | Required work |
|---|---|---|
| Booking and calendar | Phase 2 fixed the wrong-slot and exhausted-calendar defects. Integration tests cover exact consent, concurrent reservations, fresh seed dates, and persistence across restarts. | Plan a production calendar adapter when the evaluation requires live appointments. |
| Interactive lifecycle | Phase 3 adds durable lead opt-outs to backend-owned sessions and final summaries. | Verify transport hang-up and production outreach handling. |
| API and storage | Phase 2 validates inputs and returns sanitized errors. Express is a single-tenant local workspace. | Add shared-deployment authentication, tenant scoping, rate limits, and transcript retention before public access. |
| Model contract | Phase 3 separates lead evidence and validates model replies and named tools. The legacy deterministic and standalone classifier retains its rule-based behavior. | Verify the hosted model on a configured account and expand scenario evaluation. |
| Voice | Phase 2 supports authenticated provider callbacks and stored voice sessions. The outbound budget remains process-local. | Verify live audio, callback delivery, termination, and provider costs with a configured assistant before enabling real dialing. |
| Dependencies | Findings include Express transitive `proxy-addr` and `body-parser`, dev runner `shell-quote`, Vite, and Zod. | Reconcile patched locked versions and repeat the build, lint, and demo checks. |
| Follow-up | Real CRM writeback, calendar invites, email delivery, callback queue, and durable suppression are absent. | Add adapters only where required for the evaluation. |

## Local runbook

Run from the workspace root in Windows PowerShell. If the prompt already ends in `sdr-audit-baseline`, omit `Set-Location` and run `npm.cmd` directly; do not add `--prefix .\sdr-audit-baseline` from inside that folder. The locked toolchain requires at least Node 22.12 on the Node 22 line. The audit used Node 25.6.1 and npm 11.9.0. PowerShell script policy blocked `npm.ps1` on the audit host, so these commands use `npm.cmd`.

```powershell
Set-Location .\sdr-audit-baseline
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run lint
npm.cmd audit
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Set the database variables in the ignored `.env`, then run `npm.cmd run dev`. Open `http://localhost:5173` and select **Predefined** for the demo without AI or voice credentials. The servers can also run in separate terminals using `npm.cmd start` and `npm.cmd run dev:client -- --no-open`.

```powershell
Invoke-RestMethod http://localhost:3001/health
(Invoke-RestMethod http://localhost:3001/api/leads).leads.Count
$body = @{ leadId = 'lead_busy'; mode = 'deterministic' } | ConvertTo-Json
$result = Invoke-RestMethod http://localhost:3001/api/calls `
  -Method Post -ContentType 'application/json' -Body $body
$result.call.classification
```

The initial demo database produces healthy `ai-sdr`, eight leads, and `call_back_later`. Use a separate database name to verify first-run booking independently of existing reservations.

Keep secrets in ignored `.env` files. `OPENAI_API_KEY` enables AI modes. `OPENAI_MODEL`, `MAX_CALL_TURNS`, `MAX_INTERACTIVE_LEAD_TURNS`, and `MAX_OUTPUT_TOKENS` configure the model and turn limits. `AGENT_MODE` sets the server default, and `PORT` controls the backend port. `VITE_VAPI_PUBLIC_KEY` and `VITE_VAPI_ASSISTANT_ID` configure browser voice. The server Vapi configuration uses `VAPI_API_KEY`, `VAPI_PUBLIC_BASE_URL`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`, `VAPI_ALLOW_OUTBOUND_CALLS`, `VAPI_MAX_OUTBOUND_CALLS`, and `VAPI_MAX_CALL_DURATION_SECONDS`. Outbound is disabled by default. Treat `VITE_` variables as browser-visible.

## Implementation sequence and phase history

1. Connect dashboard history and appointments to the paginated MongoDB reads if the evaluation requires shared reporting.
2. Add shared deployment authentication and tenant boundaries, bound provider budgets, and remediate dependency advisories before public exposure.
3. Verify Atlas and live Vapi with an authorized test connection and configured assistant.
4. Add external integrations required by the evaluation through the existing tool interfaces.

| Phase | Recorded result | Next action |
|---|---|---|
| Phase 0 · November 25, 2026 | Repository audit complete. Build, local demo, mock tools, and stub-backed AI paths verified. | Identified calendar and booking corrections as a pending backend task. |
| Phase 1 · November 25, 2026 | Dashboard complete. Production build, lint, responsive browser checks, and stub-backed AI call workflows passed. | Move the server's persistence into MongoDB. |
| Phase 2 | MongoDB backend, validation, and booking correctness implemented. Eight integration tests passed against a local replica set, including two API restarts. | Verify the configured Atlas and provider deployments when credentials are available. |
| Phase 3 | Carla uses eight backend-controlled tools, persistent discovery, grounded knowledge, sentiment, and explainable qualification. Ten local integration tests cover realistic conversations and provider failures. | Verify live OpenAI and voice transport on configured test accounts. |
| Phase 4 · November 26, 2026 | Added a separate browser Vapi mode with permission handling, provider-confirmed connection state, transcript events, mute, interruption, timeout and duration controls. Secured the Vapi webhook and Custom LLM routes with a required shared credential, and kept model/tool execution in Express. | Verify live browser audio and then an authorized outbound call with configured Vapi credentials and a test number. |
| Post-Phase 3 verification · November 26, 2026 | User ran `npm install @vapi-ai/web @vapi-ai/server-sdk`; the second run reported both packages up to date. From the application folder, `npm.cmd test` passed 10/10, `npm.cmd run build` passed, and `npm.cmd run lint` passed. The npm install output reported 10 advisories: 1 moderate, 7 high, and 2 critical. The audit endpoint was unavailable in this environment, so the current advisory details were not independently reviewed. | Run `npm.cmd audit` where registry access works and review the affected packages before applying updates. |
