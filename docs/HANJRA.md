# Hanjra command console

This extends the existing NEXUS app. The runtime is TypeScript; Python is a one-shot adapter for already installed speech inference and pure existing Career Ops matching functions. It is not another orchestration service. Existing n8n workflows and Career Ops state are preserved.

## Start and stop

From `C:\Users\harman\NEXUS-AI-The-Next-Generation-AI-Agent-Operating-System`:

```powershell
rtk npm run hanjra
```

Open `http://127.0.0.1:3013/hanjra`. Use **Global stop** to cancel queued/running command tasks and stop new intake. **Resume intake** allows new tasks; cancelled tasks do not resume. Press **Ctrl+C** in the launching terminal to stop the server. **Escape** in the console stops capture/playback; **Cancel task** cancels work. The other NEXUS APIs are existing APIs and are not covered by Hanjra's session boundary.

The console has a same-origin, loopback-only HttpOnly session cookie. It assumes a trusted local Windows user, not a multi-user service. Do not expose this development server publicly. No external write adapters or schedules are enabled.

## Speech

The console now has **Run finalized voice commands automatically** enabled by default. A short silence after detected sound finishes the turn; manual Finish recording remains available. Low-confidence transcripts wait for review. This amplitude-based detector needs physical microphone tests; it is not a trained speech detector. A current in-app browser microphone attempt returned **Permission denied by system**. Enable Windows desktop-app microphone access and site permission, or try Edge/Chrome. The automatic listening path remains unverified until a real recording succeeds.

Choose **Cached Whisper + Windows** for the installed CPU speech adapter, or **VoiceStudio** for the separately running preferred speech service. Backend changes are explicit; no silent speech or cloud fallback occurs. Click **Push to talk**, speak, click **Finish recording**, review the finalized transcript, then **Run command**. The response is synthesized and actually passed to the selected browser output device. Playback `ended` is recorded separately from synthesis. Human listening is still needed to certify intelligibility.

The cached fallback uses faster-whisper 1.2.1 with `Systran/faster-whisper-base` revision `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66`, CPU int8, and the installed Windows David/Zira voices. Its model advertises Punjabi, Hindi, and English STT, but only English Windows TTS is installed. It uses no downloads and no audio egress. Punjabi/Hindi full voice loops and an original designed voice are unavailable until a suitable backend/profile passes human tests. Windows voices are disclosed generic voices, not an actor imitation or an original designed profile.

VoiceStudio main was inspected at `0834c8be28460fc4e0518bdb31eb57c494b253b2`; the latest observed release was v0.5.6. No installed release was available to test. The adapter first checks speech discovery and the installed OpenAPI contract, models, and voices. Configure the service URL, selected STT/TTS model, and each language's voice profile only after discovery. It does not activate VoiceStudio's arbitrary focused-window insertion. VoiceStudio is an optional separate service; no AGPL code or model weights are bundled. Distribution requires reviewing its license and the selected model licenses.

Microphone permission is requested on use; default devices and explicit device choices are supported. Capture ends at 45 seconds. Starting capture interrupts playback; echo cancellation/noise suppression are requested and playback is paused first. This coordination is implemented but physical echo/device-disconnect testing is still pending. Raw audio is confined to `data/hanjra-audio` and removed in `finally`. Fixture audio in `artifacts/hanjra/voice-fixtures_*` is deliberately retained for reproducibility. Wake-word listening and Roman transliteration are not installed.

## Configuration

See `.env.hanjra.example`. On this PC, `.env.local` explicitly selects the installed local Ollama model `qwen3.5:0.8b`. Model discovery passed, but two bounded general-response trials timed out, so conversation quality is not verified. The existing cloud credentials are preserved; their values never appear in reports. General informational replies use the existing NEXUS model transport without tools or unrelated conversation memory. No cross-provider fallback occurs. Local model multilingual quality is not certified. Deterministic command routing and task arithmetic do not depend on the LLM.

Cloud text is disabled by default. Enabling it also requires a conservative configured price and daily budget. Admission reserves enough estimated spend for bounded retries; actual cost is marked unknown without a provider receipt. This is a conservative admission cap, not an accounting claim. Status and local architecture explanations work when providers are down.

## Useful commands

- **Show completed tasks, costs, and blockers** reads persisted SQLite state.
- **Plan my day from project tasks** prepares a plan from local tasks; email/calendar are visibly disconnected.
- **Explain the Nexus architecture in Punjabi** returns a Gurmukhi explanation grounded in the local README.
- **Find five suitable jobs and prepare factual CV material** reads one current official Arbeitnow API page, deduplicates up to 25 job-detail URLs, reuses existing evidence ranking, and saves up to two factual CV extracts. Saved Berlin/EU assumptions are held for confirmation. API presence does not certify posting availability or eligibility. No submission/tracker update occurs.
- **Review an automation opportunity** with a selected `https://github.com/OWNER/REPO/issues/NUMBER` retrieves an actual open/closed request, preserves contact excerpts, applies transparent ranking, and prepares a review-only draft signed Harmanpreet. A published address is provenance, not a delivery or recipient authorization guarantee.
- **Inspect this repo** with a selected allowed repository path saves bounded file/Git inventory. Generic bug reproduction, repository test execution, automatic patching, and PR creation are not connected tools in this console.

Content/research conversational responses are labelled model-generated drafts. Financial/broker work and disconnected external operations return named blockers. Agent definitions declare responsibilities, schemas, budgets, handoffs, and verification; a role being registered does not certify an adapter.

## Persistence and policy

`data/hanjra.sqlite` is an isolated operational SQLite database using the existing libSQL dependency. Schema version 1 creates task, step, outbox, scope-grant, control, budget, and fact tables. Source migrations are in `lib/hanjra/store.ts::schema`. Tasks retain the requested contract fields, original redacted transcript, normalized command, audio/session identity, policy version, selected target, permissions, budgets, evidence, artifacts, and cost uncertainty. Fact storage is a versioned contract; no unverified profile fact is promoted automatically.

Stable command IDs suppress duplicate finals and conflicting replays. Two specialists can work concurrently. Late cancelled results cannot complete a task. Running tasks interrupted by a server restart become blocked for reconciliation; queued read/preparation tasks are recoverable. Source content and model output never supply grants. Outbox grants bind exact payload hash, account, target, action, and expiry. Fixture environments cannot reach live adapters. Ambiguous sends reconcile before retry. The outbox protocol is tested with a fake provider; a real sender, provider sent-history lookup, suppression integration, and external write/readback are not connected.

```powershell
rtk npm run hanjra:backup
rtk npm run hanjra:acceptance
rtk npm run hanjra:audit
rtk npm run verify
```

Backup uses SQLite `VACUUM INTO` to a new timestamped file. To restore, stop the server, preserve the current database under a new filename, and restore a selected backup to `data/hanjra.sqlite`. Do not overwrite or remove existing data without a reviewed restore choice. No scheduler is installed or enabled by this build. Existing schedule state belongs to the earlier workspace and remains separately unverified.

## Rollback

Baseline commit and the pre-change audit are recorded under `artifacts/hanjra`. Changes are on `codex/hanjra-command-os`; inspect its Git diff. Revert only these source changes. Keep the new operational database and generated artifacts as evidence unless explicitly retiring them. `.env.local` had three Hanjra keys appended only when absent; a rollback may remove just those appended Hanjra settings. Existing credentials were neither printed nor replaced. No existing n8n workflow/database/report was overwritten.

This delivers an initial locally verified command/speech slice. It does not complete the master prompt's production Phases C–E, multilingual human acceptance, all specialist adapters, original voice design, or authorized external-write trials. The capability report records those gaps independently.
