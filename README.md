# Nexus AI — NVIDIA Agent Workspace

Created by [Harman Hanjra](https://github.com/harmanhanjra). MIT licensed.

Nexus runs a default Head Agent, five specialists, custom agents, grounded document Q&A, and team discussions using NVIDIA NIM or an OpenAI-compatible endpoint. NVIDIA is the default provider.

## Run locally

Requires Node.js 22.6 or newer.

~~~powershell
npm install
Copy-Item .env.example .env.local
# Set NVIDIA_API_KEY in .env.local.
npm run dev
~~~

Open http://localhost:3000. Get a key from [NVIDIA Build](https://build.nvidia.com/). Keys stay on the server unless you supply a browser key in Settings. Leave Model empty to discover an available chat model.

## Features

- **Head Agent:** command built-in or custom agents directly from chat. Real delegation results feed the final answer. Up to four assignments per turn, one delegation level, shared provider and selected files. Stop cancels the run.
- **Solo agents:** Research, Coding, Content, Business, and Life Coach, with streaming, cancellation, and browser conversation history. Restored transcripts provide model context after a server restart.
- **AI SDK harness:** typed tools, tool-result follow-up turns, up to five model steps, retries, token bounds, and a 180-second specialist deadline (300 seconds for the head). Models that reject the tool protocol can fall back to plain chat.
- **NVIDIA resilience:** Nemotron 3 Super is the default. Before any answer text is shown, an unavailable NVIDIA model switches to another NVIDIA model using the same key, with a 60-second first-answer deadline per model. NVIDIA requests remain on NVIDIA rather than silently switching to another configured vendor.
- **Tools:** planning, exact arithmetic without code evaluation, memory recall, selected-file retrieval, skill search/loading, and optional live public Wikipedia search with source links. Enable tools in the agent editor.
- **Local skills:** discovers SKILL.md files under ~/.agents/skills, ~/.codex/skills, and ~/.codex/plugins/cache. Discovery deduplicates names, caches for one minute, ranks task relevance, and injects matching instructions. Open Skills to search, preview, or rescan. Skill guidance uses available app tools; it does not automatically execute arbitrary scripts or grant unavailable connector access.
- **Custom agents:** edit name, role, responsibilities, prompt, tools, temperature, provider, and model. Empty provider/model inherit workspace settings.
- **Team rooms:** sequential contributions, concurrent peer review, and synthesis. Real SSE events update the inspector. Failed steps are reported; degraded reviews or synthesis produce a partial run. Stop aborts provider calls. Runs have a 300-second deadline.
- **Files:** upload, deduplication, NVIDIA-generated briefs, selection, deletion, and grounded questions in solo chat or rooms. Missing passages produce an explicit not-found response.
- **Hybrid RAG:** NVIDIA Nemotron passage/query embeddings persisted beside document chunks, semantic and keyword ranking, cached question vectors, and context-aware follow-up retrieval. Keyword retrieval remains available during embedding outages.
- **Persistence:** browser history, room results, agents, and settings survive reloads. Originals, extracted text, summaries, and chunks use SQLite/libSQL. Long-term memory remains per server process.

## Configuration

| Variable | Purpose |
| --- | --- |
| NVIDIA_API_KEY | NVIDIA NIM credential |
| NVIDIA_EMBEDDING_MODEL | Defaults to nvidia/nemotron-3-embed-1b |
| NEXUS_DISABLE_EMBEDDINGS | Set true to use keyword retrieval only |
| NVIDIA_BASE_URL | Defaults to https://integrate.api.nvidia.com/v1 |
| OPENAI_API_KEY / OPENAI_BASE_URL | Optional compatible provider |
| NEXUS_SKILL_PATHS | Extra skill directories, separated by semicolons |
| NEXUS_DISABLE_LOCAL_SKILLS | Set true to disable host skill discovery |
| DATABASE_URL / DATABASE_AUTH_TOKEN | Optional hosted libSQL/Turso database |
| NEXUS_DATABASE_PATH | Local document database path |
| ALLOW_LOCAL_PROVIDER_URLS | Explicit opt-in for local model endpoints |
| NEXT_DIST_DIR | Isolated build directory while development runs |

PC skills are available when Nexus runs on that PC. Hosted deployments cannot discover files on your computer; local discovery is disabled on Vercel.

## Documents

PDF, DOCX, PPTX, XLSX, OpenDocument, RTF, CSV, Markdown, HTML, EPUB, and common text/code files are supported up to 15 MB. Encrypted or unsupported files return errors. Scanned PDFs require functioning OCR support.

Every extracted part is stored and searchable. Files exceeding 2 million extracted characters or 5000 parts are rejected with instructions to split them, rather than silently truncated. Long text chunks overlap. Brief generation covers batches through 180,000 source characters; larger files retain a complete extractive outline. Question answering retrieves relevant passages rather than sending entire large files on every turn. Embeddings use the server's NVIDIA key.

The local database defaults to data/nexus-documents.sqlite. Configure hosted libSQL for durable serverless storage. This local workspace has no authentication; add authenticated workspace ownership before offering it as a shared public service.

## API

| Endpoint | Behavior |
| --- | --- |
| POST /api/chat | SSE thinking, tool_call, token, citation, done, error |
| GET /api/conversations | Recent conversations or messages |
| GET/POST/DELETE /api/memory | Memory management |
| GET/POST/DELETE /api/documents | Workspace file library |
| POST /api/rooms/:roomId/run | JSON or SSE with stream: true |
| GET /api/skills | Catalogue, task matching, refresh |
| GET /api/skills?id=:id | Instructions for a discovered skill |
| GET /api/health | Provider configuration without keys |

## Validation

~~~powershell
npm run verify
npm run build
node scripts/smoke-nvidia.mjs http://localhost:3000
node scripts/create-rag-fixtures.mjs
node scripts/smoke-rag.mjs http://localhost:3000
~~~

The smoke suite sends real NVIDIA requests, creates its own synthetic document workspace, removes its test file, and saves results to artifacts/nvidia-acceptance.json. It verifies all five agents, actual calculator execution, skills, restored context, file grounding/briefs, room phases, and validation.

## Architecture

Next.js 15 and React 19 provide the UI and endpoints. Vercel AI SDK owns the bounded tool loop and compatible streaming. LlamaIndex caches retrieval over room definitions. SQLite/libSQL stores documents. Zod validates tool inputs. A native streaming adapter supports models without tool calling.

Inspired by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), Nexus focuses on a local visual workspace, NVIDIA routing, document grounding, and installed-skill selection. It is not a compatibility implementation of DeepSeek's plugin runtime; performance superiority has not been benchmarked.
