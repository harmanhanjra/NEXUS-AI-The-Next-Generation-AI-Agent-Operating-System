# Hanjra upgrade research

Researched September 30, 2026, India time. These are proposals, not installed capabilities.

## Current baseline and blockers

114 repository tests pass. The latest synthetic English STT evaluation routed 10/10 commands. A real UI status command completed and its browser playback-ended event was saved. Current career, selected repository, and public-request read checks pass. General Ollama conversation still times out. Microphone getUserMedia returned “Permission denied by system” in the in-app browser; microphone listening is not verified.

The UI now offers automatic finalized voice-command dispatch, holds uncertain transcripts for review, and includes lightweight silence-based end-of-turn detection. TypeScript and lint pass. This needs real microphone testing once permission is available. Stop/Escape halts capture and playback. No permanent listening was enabled.

## Recommended sequence

1. **Reliable voice access and app launch.** Resolve Windows/browser microphone permission, test real recordings, and package the existing console as a small Edge PWA with a microphone diagnostic and app shortcut. A PWA does not bypass permissions or start the backend automatically. [Microsoft Edge PWA documentation](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/ux).
2. **Fast conversational mode.** Diagnose the Ollama timeout with short bounded requests, model metadata, and thinking controls. The compatible endpoint supports reasoning_effort; none can disable thinking for supported boolean models. This is a diagnostic option, not a demonstrated cure for the current timeout. Add a short rolling conversation context, explicit cloud opt-in, first-token timing, and separate concise spoken answers from detailed on-screen evidence. [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [thinking](https://docs.ollama.com/capabilities/thinking).
3. **Speech-aware turn detection and interruption.** Replace amplitude-only silence hints with Silero VAD. Its maintainers report a small model and CPU inference under 1 ms per chunk under their benchmark conditions; this PC still needs benchmarking. Keep echo suppression and explicit microphone controls. [Silero VAD](https://github.com/snakers4/silero-vad).
4. **Personal memory with provenance.** Use SQLite FTS5 to search selected project notes, task outcomes, factual career evidence, and explicitly saved preferences. Attach source, verification date, expiry, and edit/forget controls. Check FTS5 availability in the installed libSQL runtime first. No broad personal-folder scan or extra vector service is needed for an initial version. [SQLite FTS5](https://sqlite.org/fts5.html).
5. **Connected tool workflows.** Expose only selected existing Career Ops, n8n, repository, and account tools through typed adapters/MCP. The useful feature is command → artifact → verification → review, with task progress in the HUD. MCP itself does not grant permission; enforce account/recipient/action scope at the tool boundary. [MCP authorization](https://apps.extensions.modelcontextprotocol.io/api/documents/authorization.html).
6. **Optional “Hey Hanjra.”** Evaluate openWakeWord after the manual loop passes. Windows uses ONNX. The supplied models currently support English, not a ready-made Hanjra phrase. A custom phrase needs training and accent/false-activation tests. Code uses Apache 2.0; supplied models use CC BY-NC-SA 4.0. Clearly distinguish personal use from commercial distribution. [openWakeWord](https://github.com/dscripka/openWakeWord).
7. **Punjabi/Hindi original voice.** Keep VoiceStudio as the preferred service and evaluate IndicF5 as a candidate model: its publisher lists Hindi and Punjabi among 11 supported Indian languages. This does not certify English, code switching, original voice identity, CPU latency, model redistribution, or this Windows installation. Review the exact model license and reference-audio rights before adoption; benchmark after allowing enough disk headroom. [Publisher model card](https://huggingface.co/ai4bharat/IndicF5?hardware=h100).

## Features that make it personal

- A morning brief grounded in actual tasks and connected calendars, with blockers first.
- “Continue yesterday’s task” from saved evidence rather than invented memory.
- “Explain this file” with an explicit selected target and cited excerpts.
- A review inbox for CV packets, outreach drafts, and code diffs.
- Voice interruption, adjustable speech length, and a visible microphone activity indicator.

Priority: microphone permission and conversational timeout first, then VAD and memory, then connected workflows. Wake word and heavier multilingual TTS follow a passing real voice loop. New schedules and external writes require their own scope.
