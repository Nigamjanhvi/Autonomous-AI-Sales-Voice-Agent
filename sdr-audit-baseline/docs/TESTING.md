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

## Current environment status

- PASSED: TypeScript production build.
- PASSED: Oxlint.
- PASSED: MongoDB integration suite (10 tests), including restart persistence, a real multipart TXT
  upload and retrieval, and foreign-workspace read/list/delete rejection plus workspace spoof rejection.
- NOT TESTED: Full end-to-end browser workflow. The API integration suite did exercise TXT upload
  against its disposable MongoDB replica set; PDF and DOCX extraction were not executed here.
- REQUIRES CONFIGURATION: Real OpenAI embeddings and Atlas Vector Search; no Atlas index status has
  been inspected from this workspace.
- REQUIRES CONFIGURATION: Vapi live browser voice and actual call; credentials/public callback are
  not verified.
