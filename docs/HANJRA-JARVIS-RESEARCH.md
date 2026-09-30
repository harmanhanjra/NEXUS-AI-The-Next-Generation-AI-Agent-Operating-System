# Jarvis research and Hanjra design direction

Reviewed 30 September 2026. Repository features below are author claims and architectural references, not independent performance certification. No third-party assistant was installed or executed.

## Why people build these assistants

The recurring goals are hands-free interaction, one interface across applications, less repetitive work, and ownership of personal data and provider choice. Fictional Jarvis supplies an understandable interaction model: speak naturally, see what the assistant is doing, receive an answer or completed action. These motivations are an inference from the projects' stated purposes, rather than a survey of all builders.

[Personal Jarvis](https://github.com/stevensaint/jarvis) emphasizes voice, desktop actions, persistent knowledge, and isolated coding workers. [ndunl075/Jarvis](https://github.com/ndunl075/Jarvis) emphasizes Windows, local inference, no subscription, and speech plus everyday desktop tools.

## How they build it

The common pipeline is microphone → wake phrase or push to talk → voice activity detection → transcription → intent/tool routing → execution → verified result → speech. Local options often combine faster-whisper, Ollama, and a local voice. Transport, interruption, conversation context, and permissions are separate concerns from the animated orb.

| Reference | Pattern worth studying | Fit for Hanjra |
| --- | --- | --- |
| [ndunl075/Jarvis](https://github.com/ndunl075/Jarvis) | Local Windows pipeline; Silero endpointing; Piper speech; conversation history; simple intent routing; per-interaction logs | Closest architectural reference to our existing Whisper/Ollama setup. Its README includes a release-link caveat, so treat it as code to inspect, not a verified ready-to-install product. |
| [Personal Jarvis](https://github.com/stevensaint/jarvis) | Separate conversational, tool, and long-running worker tiers; Markdown knowledge; isolated workspaces; provider choice | Keep spoken acknowledgements quick while durable jobs continue separately. Add inspectable memory and worker outcomes. |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | Composable realtime audio pipelines, WebSocket/WebRTC transports, pluggable STT/LLM/TTS, debugging and metrics | Useful if replacing batch audio uploads with streaming. Pilot one local pipeline instead of importing every integration. |
| [LiveKit Agents](https://github.com/livekit/agents) | AgentSession, interruption handling, turn detection, tools, handoffs, evaluation support, self-hostable transport | Strong reference for realtime conversation and future phone/browser clients. Additional infrastructure must justify its resource cost. |
| [openWakeWord](https://github.com/dscripka/openWakeWord) | Local wake detection and evaluation of false accepts/rejects in realistic noisy audio | Add only after testing a custom Hanjra phrase on this microphone. A pretrained English trigger does not prove Punjabi/Hindi phrase support. |

The old Open Interpreter URL currently redirects to [openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter), whose current positioning is a coding agent. Older articles describing its desktop voice interface should not be taken as documentation of today's product.

## Priorities for our project

1. **Reliable voice setup.** Show permission state, actual device selection, microphone level, and a short record/playback check. Measure human speech in English, Hindi, Punjabi, and mixed language. Synthetic English fixtures are insufficient.
2. **Conversation continuity.** Add bounded session history and explicit follow-up targets, then streaming transcription/speech and barge-in. Keep a visible stop control. Current silence detection is an amplitude heuristic, not a trained VAD.
3. **Useful local memory.** Save user-confirmed preferences and project facts with source, timestamp, expiry, edit, and removal. Retrieve relevant facts, not all private history.
4. **Typed tools with evidence.** Add bounded local file search, approved workspace launchers, and repository checks. Every tool needs a schema, timeout, cancellation, scope, and readback. External sends and irreversible actions need an exact approval.
5. **Fast voice, durable work.** Acknowledge long jobs immediately, persist progress, and deliver the completed artifact later. Benchmark the installed small model before allowing autonomous tool selection.
6. **Practical personal workflows.** Career preparation grounded in existing facts, coding diagnostics, cited research reports, and a project briefing are more distinctive for Harman than a large generic tool count.
7. **Desktop packaging and wake phrase.** Consider a lightweight tray companion after browser voice is verified. Use opt-in listening with mute/sleep state, on-device wake detection, and measured false activations.

Current boundaries: Windows consent values are enabled; a real microphone recording still needs verification. The local model has completed the live acceptance command. Email/calendar accounts, generic desktop actuation, and broker execution remain disconnected. No research repository establishes that Hanjra has those capabilities.

## Interface references applied

- [ThreeUI](https://threeui.com/): spatial focal point and restrained dimensional motion. Hanjra uses an original lightweight Canvas particle sphere; no premium renderer source was copied.
- [Taste Skill documentation](https://www.tasteskill.dev/docs): consistent accent and shape, stronger typographic hierarchy, purpose-driven layout, and visible primary controls.
- [21st.dev](https://21st.dev/): compact navigation, component composition, and polished interactive controls. No catalog component was represented as installed.
- [GSAP matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/): scoped entrance choreography with cleanup and reduced-motion support. GSAP is installed and used in the console.

The redesign keeps the existing command, device, language, task history, result, evidence, and stop functions. Particle rendering is capped around 30 frames per second, skips drawing in a hidden tab, and renders a still frame when reduced motion is requested.

## Redesign verification

- TypeScript check and ESLint completed successfully after the redesign.
- Browser layout checked at requested widths 320, 768, 1024, and 1440; document width equaled available viewport width in all four checks, with no horizontal overflow.
- The redesigned console ran "Show completed tasks, costs, and blockers" through the real API. Task `f161af61-60f6-4120-b917-45e3776c5c91` completed and displayed its local SQLite evidence and execution record.
- Automatic speech was disabled only during that UI smoke check, then restored to enabled. No physical microphone or human listening result was inferred from this test.
- Screenshot: `artifacts/hanjra/redesign-desktop.png`.
