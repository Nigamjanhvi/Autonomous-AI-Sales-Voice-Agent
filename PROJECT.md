# Autonomous AI Sales Voice Agent

This is the running project record for the Fortivex AI technical evaluation. Update the current phase, decisions, verification evidence, and next approval gate here at each phase.

## Current phase

| Item | Status |
|---|---|
| Current phase | **Phase 1 — Professional AI Sales Operations Dashboard complete**, November 25, 2026 |
| Open implementation item | Calendar and booking correctness remains pending. Phase 1 focuses on the frontend dashboard. |
| Evaluation repository | [Nigamjanhvi/Autonomous-AI-Sales-Voice-Agent](https://github.com/Nigamjanhvi/Autonomous-AI-Sales-Voice-Agent), cloned at the workspace root with no commits at audit time |
| Approved baseline | [Dekelbo/SDR_CallingAgent at `0b2dcf53213cda4a7e2dc4b219d4532c4d303cd2`](https://github.com/Dekelbo/SDR_CallingAgent/tree/0b2dcf53213cda4a7e2dc4b219d4532c4d303cd2), checked out separately in `sdr-audit-baseline/` |
| Working source | The dashboard is implemented in the approved baseline checkout. Phase 1 keeps the existing Express routes and contracts. |
| Reuse | The baseline has no tracked license file and declares `UNLICENSED`. Confirm reuse permission before publishing its code or assets to the evaluation repository. |

## Project purpose

Carla is an AI sales development representative. The project demonstrates a permission-based outbound conversation, CRM-informed discovery, objection handling, meeting scheduling, and post-call classification. The current evaluation baseline uses mock CRM and calendar data. Email, invites, and callbacks are recorded as recommended actions. Optional Vapi paths provide browser audio and an outbound dialing adapter.

## Technology stack and architecture

| Layer | Current implementation |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, and CSS. Responsive dashboard shell with eight views and a lazy-loaded live call console. |
| Backend | Node.js, Express 5, TypeScript, `tsx`, dotenv, and CORS. The default API port is 3001. Vite normally serves the UI on 5173. |
| AI | OpenAI SDK 6, Chat Completions JSON mode, configurable model with `gpt-4.1-mini` as the baseline default. Separate requests generate Carla's reply and classify lead intent. |
| Voice | Browser `SpeechRecognition` for interactive lead input, `@vapi-ai/web` for optional agent playback, and `@vapi-ai/server-sdk` for planned or real outbound calls. |
| Storage | JSON seed fixtures in `src/server/data/` and file-backed server state under ignored `logs/`. The dashboard captures browser-local call records and preferences in localStorage and document files in IndexedDB. |
| Verification | TypeScript project references, Vite build, Oxlint, and npm lockfile. No tracked test suite or CI workflow exists. |

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
        ├── index.ts, types.ts
        ├── agent/             Carla's prompt and LLM orchestration
        ├── calls/             Mode selection and deterministic scenarios
        ├── config/            Carla's profile
        ├── data/              Eight mock leads and five calendar slots
        ├── routes/            Call, tool, and Vapi endpoints
        ├── storage/           JSON file handling
        ├── tools/             Lead, calendar, booking, summary, outcome
        └── vapi/              Voice service and provider adapters
```

Runtime files include `logs/calendar-state.json`, `logs/calls/*.json`, and `logs/summaries/*.json`. The audited commit tracks 42 files. Its three `.gitkeep` placeholders are redundant, and `src/assets/*` and `public/icons.svg` have no application references. Phase 1 imports existing backend types into the frontend as type-only dependencies and replaces the previous call stylesheet. Zod has no application imports, while both Vapi SDKs have call sites.

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

Overview conversion is distinct CRM leads with a booked meeting divided by total CRM leads. Analytics appointment conversion is booked calls divided by calls in the selected period. The default qualification threshold is 60. Calls with high, medium, or low interest start at 80, 50, or 25, with up to 15 points for recorded pain points. Bookings score 100 and declines or disqualifications score 0. Sentiment is a keyword-based estimate from lead replies.

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
2. OpenAI generates Carla's opening and replies. The lead still follows a fixture. Separate model calls classify the lead's intent, and TypeScript decides when to execute tools. The model request supplies no OpenAI function definitions.
3. The interested fixture has a dedicated branch for scripted acceptance and booking. The backend saves the completed result. The browser replays the transcript and can use Vapi to speak Carla's lines when configured.

### AI (Interactive)

1. The browser starts an LLM call and receives Carla's opening. The user types a reply or captures it through the browser microphone using the configured input language.
2. The browser sends the call ID, lead ID, transcript, and latest reply. The backend classifies intent, checks scheduling rules, and returns a tool-backed or model-generated reply. The browser can play agent text through a separate muted Vapi session using `vapi.say`.
3. The backend writes a call snapshot on turns. Booking and the scheduling-email branch save summaries. The dashboard honors the backend's completion status and captures a history entry when the call ends. Manual **End call** stops the local console and records a local history entry. Reaching the turn limit can still leave an unfinished backend summary.

### Vapi outbound and webhooks

`POST /api/vapi/calls` defaults to dry run. Real dialing requires explicit opt-in, a server key, a phone number ID, an assistant ID, and a customer number. The configured assistant can forward model requests to `/api/vapi/chat/completions`, which derives the lead from metadata and invokes the interactive orchestrator. `/api/vapi/turn` is a direct transcript adapter. `/api/vapi/webhook` acknowledges `message.type` without processing call lifecycle events. Live audio, streaming compatibility, callback authentication, actual hang-up, and end-of-call persistence remain unverified. [Vapi server events](https://docs.vapi.ai/server-url/events) · [Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication)

## Carla's prompt and backend tools

[Carla's prompt](sdr-audit-baseline/src/server/agent/carlaSystemPrompt.ts) defines identity, permission-based discovery, concise pitching, objection handling, and opt-out behavior. It calls for CRM context before personalization and explicit acceptance of an available time before booking. It prohibits invented CRM data, availability, product features, pricing, and guarantees. Deterministic mode uses its own scripted dialogue.

| Tool | Behavior |
|---|---|
| `getLeadContext` / `getAllLeads` | Reads the CRM seed and resolves one lead or lists all leads. |
| `checkCalendarAvailability` | Reads runtime or seed slots, filters by availability and optional date prefix, and returns up to three. |
| `bookMeeting` | Checks the lead and slot, marks the slot booked in local calendar JSON, and returns meeting details. |
| `saveCallSummary` | Writes a timestamped JSON summary and returns its ID and filesystem path. |
| `classifyLeadOutcome` | Applies ordered keyword and summary rules. It prioritizes booking and can interpret both speakers' words as outcome signals. |

## API inventory

| Method and route | Purpose |
|---|---|
| `GET /health` | Backend health |
| `GET /api/agent` | Carla's profile |
| `GET /api/leads` | CRM lead list |
| `GET /api/leads/:leadId` | One CRM lead |
| `GET /api/calendar/availability` | Availability, optionally with `preferredDate` |
| `POST /api/meetings` | Mock booking from `leadId`, `slotId`, and optional `notes` |
| `POST /api/call-summaries` | Writes a submitted summary |
| `POST /api/lead-outcomes/classify` | Classifies a transcript and optional summary |
| `POST /api/calls` | Complete deterministic or scripted LLM demo |
| `POST /api/calls/interactive/start` | Generates an opening for `leadId` and `mode: "llm"` |
| `POST /api/calls/interactive/turn` | Uses `leadId`, optional `callId`, `transcript`, and `leadReply` |
| `GET /api/vapi/config` | Vapi configuration and process-local call budget |
| `POST /api/vapi/calls` | Planned or real outbound call |
| `POST /api/vapi/webhook` | Acknowledges the Vapi message type |
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
| Booking | **Reproduced.** Accepting option 2 booked option 1. A fresh availability lookup picks `slots[0]`, and a model flag can trigger booking without a recorded offer. | Record offered slot IDs server-side, resolve the accepted option, and reject an unavailable slot without substituting. |
| Calendar | **Reproduced.** Exhausting available slots reopens booked seed slots. Fixtures use past June–July 2026 dates. Concurrent read-modify-write calls can lose updates or double-book. | Keep persisted exhaustion authoritative, use future mock dates, and make reservations atomic within the supported storage design. |
| Interactive lifecycle | **Reproduced in Phase 0.** The turn limit marks the call ended while keeping an in-progress summary. Phase 1 uses the backend status in the console. Manual end remains browser-local. | Store server-owned sessions, expose lifecycle status, and finalize each terminal path once. |
| API and storage | Invalid mode was accepted during the audit. Runtime schemas, auth, rate limits, and constrained output fields are missing. Caller-supplied IDs reach filesystem paths and errors expose internal details. | Validate boundaries and IDs, restrict routes and data access, return stable errors, and handle transcript retention. |
| Model contract | Reply JSON is cast without schema validation. Intent flags use boolean coercion. The classifier mixes agent and lead messages and differs from prompt outcome labels. | Validate model output, separate speaker signals, and align public outcomes and finalization rules. |
| Voice | Browser effects can reconnect after end or failure. The outbound counter is process-local and increments after the provider request. The outbound payload uses a legacy URL field. | Fix connection lifecycle, enforce the budget, reconcile SDK types, and verify provider events, transport, and call termination. |
| Dependencies | Findings include Express transitive `proxy-addr` and `body-parser`, dev runner `shell-quote`, Vite, and Zod. | Reconcile patched locked versions and repeat the build, lint, and demo checks. |
| Follow-up | Real CRM writeback, calendar invites, email delivery, callback queue, and durable suppression are absent. | Add adapters only where required for the evaluation. |

## Local runbook

Run from the baseline checkout in Windows PowerShell. The locked toolchain requires at least Node 22.12 on the Node 22 line. The audit used Node 25.6.1 and npm 11.9.0. PowerShell script policy blocked `npm.ps1` on the audit host, so these commands use `npm.cmd`.

```powershell
Set-Location .\sdr-audit-baseline
npm.cmd ci
npm.cmd run build
npm.cmd run lint
npm.cmd audit
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
```

Open `http://localhost:5173`. Select **Predefined** for the credential-free demo. The servers can also run in separate terminals using `npm.cmd start` and `npm.cmd run dev:client -- --no-open`.

```powershell
Invoke-RestMethod http://localhost:3001/health
(Invoke-RestMethod http://localhost:3001/api/leads).leads.Count
$body = @{ leadId = 'lead_busy'; mode = 'deterministic' } | ConvertTo-Json
$result = Invoke-RestMethod http://localhost:3001/api/calls `
  -Method Post -ContentType 'application/json' -Body $body
$result.call.classification
```

Expected results are healthy `ai-sdr`, eight leads, and `call_back_later`. The audit checkout contains generated booking state under `logs/`. Use clean mock state to verify first-run booking.

Keep secrets in ignored `.env` files. `OPENAI_API_KEY` enables AI modes. `OPENAI_MODEL`, `MAX_CALL_TURNS`, `MAX_INTERACTIVE_LEAD_TURNS`, and `MAX_OUTPUT_TOKENS` configure the model and turn limits. `AGENT_MODE` sets the server default, and `PORT` controls the backend port. `VITE_VAPI_PUBLIC_KEY` and `VITE_VAPI_ASSISTANT_ID` configure browser voice. The server Vapi configuration uses `VAPI_API_KEY`, `VAPI_PUBLIC_BASE_URL`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`, `VAPI_ALLOW_OUTBOUND_CALLS`, `VAPI_MAX_OUTBOUND_CALLS`, and `VAPI_MAX_CALL_DURATION_SECONDS`. Outbound is disabled by default. Treat `VITE_` variables as browser-visible.

## Implementation sequence and phase history

1. Correct booking and calendar integrity. Verify that option 2 books the exact offered slot, that an unavailable accepted slot is never silently replaced, and that exhausted slots stay unavailable.
2. Finish interactive sessions, outcomes, and finalization. Keep the browser and backend on one lifecycle contract.
3. Harden API boundaries and provider budgets, and remediate dependency advisories before public exposure.
4. Verify Vapi end to end with authenticated provider events and reliable call termination before enabling real outbound calls.
5. Add external integrations required by the evaluation through the existing tool interfaces.

| Phase | Recorded result | Next action |
|---|---|---|
| Phase 0 · November 25, 2026 | Repository audit complete. Build, local demo, mock tools, and stub-backed AI paths verified. | Identified calendar and booking corrections as a pending backend task. |
| Phase 1 · November 25, 2026 | Dashboard complete. Production build, lint, responsive browser checks, and stub-backed AI call workflows passed. | Calendar and booking corrections remain pending. |
