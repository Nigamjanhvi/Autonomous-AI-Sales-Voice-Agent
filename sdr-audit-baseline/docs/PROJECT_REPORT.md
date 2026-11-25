# Project report: Phases 5–7

## Existing application

The repository was already a React/TypeScript dashboard and Express/MongoDB agent application. It
already included deterministic and OpenAI LLM call orchestration, persistent calls/transcripts and
summaries, evidence-based lead qualification, MongoDB appointment reservations, and optional Vapi
transport. Knowledge documents were the major mismatch: uploaded dashboard files stayed in browser
IndexedDB while the backend accepted only plain text and used MongoDB text search.

## Implemented

- Added trusted configured `workspace_default` context; document reads, writes, deletes, reprocess,
  and retrieval are scoped server side.
- Added multipart PDF/DOCX/TXT upload, 10 MB limit, MIME/extension checks, generated disk keys,
  duplicate checks, local original storage, extraction, normalization, chunking, status/error
  updates, listing, reading, reprocessing, deletion, and search test API/UI.
- Added optional actual OpenAI `text-embedding-3-small` chunk/query embeddings with 1536 dimension
  validation and bounded retries. Atlas vector search is attempted only when enabled and configured;
  MongoDB text search remains the labeled fallback.
- Added Hindi product-question detection, while preserving Carla's existing same-language prompt.
- Added local setup, architecture, and test documentation.

## Dependencies and data

Added `multer`, `pdf-parse`, and `mammoth`. MongoDB knowledge document/chunk schemas now include
workspace IDs, statuses, errors, checksums, optional embeddings, and workspace scoped indexes.
Existing legacy documents are not automatically migrated; newly created app docs use the default
workspace. `.env` is ignored by Git and `.env.example` includes safe settings.

## External configuration and limitations

Set `MONGODB_URI` and `MONGODB_DB`. For semantic search also set a real backend `OPENAI_API_KEY`,
`RAG_EMBEDDINGS_ENABLED=true`, and create the `knowledge_chunks_vector` Atlas index described in
`ARCHITECTURE.md`. This session did not verify an Atlas index or real semantic retrieval. Current
default is MongoDB text search. This is a single local workspace, not authenticated multi-tenancy.
The app keeps appointments internal and does not send calendar invites. Real Vapi voice was not
tested; credentials and reachable HTTPS callbacks are required.

## Test status and commands

Commands: `npm.cmd ci`, `npm.cmd run dev`, `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd test`.
The build and lint passed. All 10 MongoDB integration tests passed, including a real TXT multipart
upload/retrieval against disposable MongoDB and workspace-isolation assertions. No browser
end-to-end, PDF/DOCX upload, real OpenAI, Atlas vector query, or Vapi call is claimed as passed. See
`TESTING.md` for the executable demonstration steps.
