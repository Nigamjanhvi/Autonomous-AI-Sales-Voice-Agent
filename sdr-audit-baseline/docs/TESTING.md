# Testing and local demonstration

For detailed manual checks in Hinglish, including Vapi voice setup and troubleshooting, see
[USER_GUIDE_HINGLISH.md](USER_GUIDE_HINGLISH.md).

## Automated checks

Run from `sdr-audit-baseline`:

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test
```

Integration tests use a disposable MongoDB replica set when `mongod` is available, or a dedicated
`MONGODB_TEST_URI`. LLM requests are served by a local test stub. These checks do not prove behavior
against an actual OpenAI account, Atlas Vector Search index, browser microphone, or Vapi account.

## Manual local demo

1. Configure `MONGODB_URI` in `.env` and run `npm.cmd run dev`.
2. Open `http://localhost:5173`; verify lead list and live call screens load.
3. On Knowledge Base, upload a text based PDF, DOCX, or TXT. Wait for status `indexed`.
4. Use **Test knowledge search** and ask a question answered in that file. Confirm the result shows
   its source title. Ask an unsupported question and confirm no source is returned.
5. In deterministic mode, run a lead call and verify transcript, summary, classification, and booking
   tools. To test natural English/Hindi turns, set `AGENT_MODE=llm` and provide a valid key; the
   model must be configured to return Hindi for a Hindi request.
6. In an interactive LLM conversation ask Carla to offer availability, choose a specific numbered
   slot, then confirm that same slot. Check Appointments and `GET /api/appointments`.
7. Check Call History and Analytics for persisted call data. Restart the backend and verify records
   remain in MongoDB.
8. Test voice only after Vapi credentials and public HTTPS callbacks are configured.

Do not count a local text-search result as vector search. Set RAG embeddings, create the Atlas index,
then query through the UI and inspect the reported retrieval mode to verify vector search.

## Vapi browser voice check (real provider required)

The owner reports Carla assistant v3 is published at 100% traffic with Custom LLM base URL
`https://YOUR_NGROK_DOMAIN/api/vapi`, endpoint suffix `/chat/completions`, and the Assistant Server
URL `https://YOUR_NGROK_DOMAIN/api/vapi/webhook`. Dashboard state and live connectivity have not
been independently checked by this repository test suite. Verify the resolved Custom LLM URL is
`/api/vapi/chat/completions`.

The package scripts verified in `package.json` are `npm.cmd run dev`, `npm.cmd run dev:server`,
and `npm.cmd run dev:client`. To use three terminals from `sdr-audit-baseline`:

```powershell
# Terminal 1
npm.cmd run dev:server
```

```powershell
# Terminal 2
npm.cmd run dev:client
```

```powershell
# Terminal 3; ngrok is an external CLI, not a package script
ngrok http 3001
```

Or use `npm.cmd run dev` for both app processes and a separate ngrok terminal. Set
`VAPI_PUBLIC_BASE_URL` to ngrok's HTTPS forwarding base URL, and use the same current domain in the
Vapi Custom LLM and webhook URLs. When the ngrok URL rotates, update all locations and restart the
app. Keep `VAPI_ALLOW_OUTBOUND_CALLS=false` for browser-only audio testing.

Test: check `http://localhost:3001/health/db`, open `http://localhost:5173`, choose **Live Calls**,
select a lead, start **Vapi Live Voice**, grant microphone permission, speak, end the call, then
check Call History and `GET /api/calls` / `GET /api/calls/:callId`.

Troubleshooting:

- **Health check fails:** verify the backend terminal, `MONGODB_URI`, database access, and
  `http://localhost:3001/health/db` before testing Vapi.
- **ngrok disconnected/URL changed:** restart `ngrok http 3001`; update `VAPI_PUBLIC_BASE_URL`, the
  Custom LLM URL and Assistant Server URL to the new HTTPS host; restart the app.
- **Invalid Bearer token:** Custom LLM and webhook routes require `Authorization: Bearer ...`
  matching `.env` `VAPI_SHARED_SECRET` and the Vapi server credential.
- **Custom LLM request fails:** ensure the resolved URL ends `/api/vapi/chat/completions`, backend
  is reachable via HTTPS, and `OPENAI_API_KEY` is valid. The handler returns JSON and does not
  implement SSE streaming.
- **Missing lead/call metadata:** requests need a provider call ID and a lead ID in supported call
  metadata/variable locations. The browser integration supplies selected lead metadata.
- **Microphone blocked:** allow microphone for the local frontend in browser site settings; retry
  after permissions are granted.
- **Webhook fails:** confirm POST `/api/vapi/webhook`, HTTPS host, matching Bearer credential, and
  that the event is `end-of-call-report`. Other event types are only acknowledged; they do not
  update status/transcript in this backend handler.

## Current environment status

- PASSED: TypeScript production build.
- PASSED: Oxlint.
- PASSED: MongoDB integration suite (10 tests), including restart persistence, a real multipart TXT
  upload and retrieval, and foreign-workspace read/list/delete rejection plus workspace spoof rejection.
- PASSED (automated, stubbed): Vapi route auth and a JSON Custom LLM response shape. This test uses a
  local model stub and test Bearer token; it is not a live Vapi or ngrok test.
- NOT TESTED: Full end-to-end browser workflow. The API integration suite did exercise TXT upload
  against its disposable MongoDB replica set; PDF and DOCX extraction were not executed here.
- REQUIRES CONFIGURATION: Real OpenAI embeddings and Atlas Vector Search; no Atlas index status has
  been inspected from this workspace.
- CONFIGURED/PUBLISHED (user-reported): Carla Vapi assistant v3 at 100% traffic, Custom LLM and
  webhook settings. Not independently inspected in the Vapi dashboard.
- NOT YET VERIFIED: Live Vapi browser call, current ngrok tunnel, webhook delivery, and transcript /
  summary finalization from a real provider end-of-call report.
