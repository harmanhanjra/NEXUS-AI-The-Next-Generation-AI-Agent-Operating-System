# OpenJarvis analysis and Hanjra implementation

## Reference review

Reviewed 30 September 2026. Upstream main reported commit `f0ecea0dc4c3144e91352449aae0dd3ef88d0280`. Selected source files were read directly; a full clone was cancelled when the PC ran out of storage. This is a focused architecture/source review, not an audit of every upstream file or a claim that its tests were run.

Read the README, architecture overview, memory, learning, query-flow and security docs, Python dependency manifest, frontend dependency manifest and layout, desktop memory/learning components, learned router implementation, memory store, trace store, and telemetry aggregator. No upstream installer or downloaded code was executed.

## What the repository actually provides

| Area | Finding | Relevant source |
| --- | --- | --- |
| Architecture | Intelligence, engine, agents, memory, and learning are separated. Traces connect execution to subsequent improvement. | [Overview](https://github.com/open-jarvis/OpenJarvis/blob/main/docs/architecture/overview.md) |
| Inference | Pluggable local and cloud engines share generation, streaming, health, and model inventory interfaces. | [Engine](https://github.com/open-jarvis/OpenJarvis/tree/main/src/openjarvis/engine) |
| Memory | SQLite is the lightweight default; sparse and dense retrieval backends have distinct resource and persistence tradeoffs. | [Memory](https://github.com/open-jarvis/OpenJarvis/blob/main/docs/architecture/memory.md) |
| Learning | The reviewed learned router uses query classes and trace outcomes to choose models. Its source includes sample thresholds and fallback behavior. It is not equivalent to continually fine-tuning an LLM. | [Learned router source](https://github.com/open-jarvis/OpenJarvis/blob/main/src/openjarvis/learning/routing/learned_router.py) |
| Research features | Documentation distinguishes active trace-driven policies from a GRPO routing stub. Training and spec-search modules have separate requirements; a directory name does not prove a production learning pipeline is active. | [Learning architecture](https://github.com/open-jarvis/OpenJarvis/blob/main/docs/architecture/learning.md) |
| Observability | Trace persistence and telemetry aggregation distinguish steps, timing, outcomes, and inference metrics. Energy requires actual instrumentation. | [Trace store](https://github.com/open-jarvis/OpenJarvis/blob/main/src/openjarvis/traces/store.py), [Telemetry aggregator](https://github.com/open-jarvis/OpenJarvis/blob/main/src/openjarvis/telemetry/aggregator.py) |
| UI | React/TypeScript with Vite, state management, UI primitives, dashboard panels, and an optional Tauri desktop layer. | [Frontend manifest](https://github.com/open-jarvis/OpenJarvis/blob/main/frontend/package.json), [Layout](https://github.com/open-jarvis/OpenJarvis/blob/main/frontend/src/components/Layout.tsx) |
| Protection | Security scanning, restricted file access, audit events, and optional container isolation are separate subsystems. | [Security](https://github.com/open-jarvis/OpenJarvis/blob/main/docs/architecture/security.md) |

## Stack selected for this PC

Observed: Intel i7-8550U (4 cores), approximately 16 GB physical RAM, Intel UHD Graphics 620. C: had about 60 MB free during the reference download; removing generated caches and the cancelled reference checkout recovered some space, but capacity remains low. No new packages or model weights were installed.

| Layer | Selected technology | Why |
| --- | --- | --- |
| Interface | Existing React + TypeScript + Next.js | Keeps working chat, voice, rooms, and APIs while adding dedicated intelligence views. A migration to Vite would duplicate functioning infrastructure without improving inference. |
| Durable state | Existing libSQL/SQLite | Tasks, steps, explicit memory notes, and feedback survive restarts in the existing local database. |
| Local generation | Existing quantized Ollama model | Suitable starting point for this CPU; actual model capability still needs task-specific evaluation. Live inventory is read from the local engine. |
| Speech recognition | Existing Python/cached Whisper service | Reuses working local ML infrastructure without additional downloads. |
| Retrieval | BM25 ranking over saved notes | Small, transparent, CPU-only keyword retrieval. This is sparse retrieval, not semantic embeddings. |
| Learned specialist selection | Multinomial Naive Bayes in TypeScript | A real statistical classifier trained on explicit reviewed examples. Small enough to run in the API process; no GPU or large ML runtime needed. |
| Evaluation | Leave-one-query-out label evaluation | Deduplicates normalized requests and reports acceptance coverage alongside agreement. Does not claim answer quality or calibrated confidence. |
| Diagnostics | Authenticated local API + trace browser | Uses recorded task data and model timings; unknown metrics stay unknown. |

Python remains appropriate for future embedding/reranking or model-training services when their dependencies and datasets are justified. Tauri is a reasonable later packaging option once desktop capabilities and disk capacity are ready. Neither was installed or presented as an active feature in this iteration.

## Implemented workflows

- `/hanjra/intelligence` provides Overview, Memory, Learning, Models & device, and Execution traces, with responsive navigation and shared themes.
- Memory creation redacts recognized credential patterns. Notes can be archived and restored. Archived notes are excluded from retrieval.
- Local model requests retrieve up to three relevant notes, cap each excerpt at 600 characters, mark them as untrusted reference data, and record retrieval IDs plus source attribution. These notes are excluded from cloud model requests.
- Reviews of completed live tasks are stored explicitly. Positive reviews contribute labels; negative reviews withdraw a task from positive training. Re-review replaces the existing label.
- The classifier needs at least 8 deduplicated examples, 2 classes, 3 examples for its winning label, a model score of at least 0.8, and known-word coverage of at least 0.4. Unknown commands may use a learned specialist persona; explicit action rules always take precedence. No learned label adds tools or permissions.
- Held-out evaluation excludes each unique query from its training fold. Scores are model scores, not calibrated probabilities. Agreement is conditional on accepted predictions; low coverage and small sample sizes remain visible.
- Traces expose dispatch, retrieval, inference timing, verification, and failures. Task metrics cover the latest 50 records; the trace browser shows the latest 30. Energy is explicitly unavailable.
- Model inventory uses a fixed loopback Ollama URL with a timeout and disallowed redirects. The browser cannot supply arbitrary URLs, model downloads, commands, or credentials to this endpoint.

## Deliberate limits

This iteration implements an OpenJarvis-inspired local intelligence layer. It does not embed OpenJarvis, claim parity with all its integrations, train foundation-model weights, install a native desktop shell, measure energy, enable wake-word capture, or enable unrestricted computer control. The existing model may still generate weak answers; recorded completion alone does not certify quality.

Future work should proceed from measured needs: representative answer-quality benchmarks, optional local embeddings after storage recovery, a background worker service for durable schedules, then a desktop shell with narrowly scoped adapters. Each feature needs its own acceptance evidence.

## Verification

- Production build passed, including `/hanjra/intelligence` and its authenticated API. Existing llamaindex duplicate-import warning remains. No new dependencies were added.
- Type checking and lint passed. All 121 automated tests passed, including held-out classifier predictions, out-of-domain abstention, deduplication, multilingual tokenization, archive exclusion, feedback withdrawal, and runtime precedence of explicit action policy over learned labels. New unit fixtures use isolated in-memory SQLite; durable storage was checked through the live API and a browser reload.
- Live acceptance passed nine checks; see `artifacts/hanjra/openjarvis-acceptance.json`. Actual task `86057b99-8c6b-4958-9575-22a9eab644cd` completed using local `qwen3.5:0.8b`, with memory retrieval recorded and the saved project-stack note present in source evidence. The test review was withdrawn from positive training afterwards; no artificial positive dataset is retained.
- Browser: overview, memory creation and reload persistence, ranked search and empty search state, learning navigation, actual model inventory/device profile, and execution-record selection were exercised. Keyboard activation worked when pointer dispatch was intermittent.
- Learning-view width checks at 320, 768, 1024, and 1440 pixels returned document widths 310, 758, 1014, and 1430 respectively. Temporary tab-specific emulation was cleared afterwards.
- Screenshot capture timed out in the in-app browser, including its documented CDP capture path. No screenshot is presented as proof of this iteration. The running UI and API/test reports are the available verification artifacts.
