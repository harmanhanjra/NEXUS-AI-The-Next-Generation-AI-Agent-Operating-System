# Nexus NVIDIA verification

The production build is running at http://localhost:3001. The user's existing development server was left in place.

## Results

- Type checking and ESLint: passed.
- Automated tests: 100 passed, zero failures.
- Production build: passed with an isolated output directory and disk-cache disabled.
- Live NVIDIA acceptance: 22/22 passed; see `nvidia-acceptance.json`.
- Live document acceptance: 9/9 passed; see `rag-acceptance.json`.
- Patch whitespace check: passed.
- Gemini references in app/provider code and public configuration: none.

The live suites verify all five specialists, custom-agent prompts, calculator execution, Wikipedia search, automatic skill selection, memory operations, conversation context, upload/deduplication, citations, semantic matching, summaries, room discussion/review/synthesis, request validation, and same-key recovery between NVIDIA models. Document checks cover PDF, DOCX, XLSX, CSV, two-file answers, pronoun follow-ups, late-file passages, selection isolation, and grounded room synthesis without unrelated skills.

Browser checks verified calculator results, file upload and cited answers, document briefs, 430 installed skills and instruction previews, custom-agent creation and persistence, settings Cancel and Save, cancellation, and a completed three-specialist room with source-cited synthesis. `nexus-verification.png` shows the tested chat, actual calculator output, uploaded file, and NVIDIA connection.

## Practical limits

Supported document types have a 15 MB upload limit and a 2-million-character/5000-part extraction limit. Unsupported or locked files return explicit errors. OCR depends on working OCR support. Large documents are retrieved by relevant passages; entire files are not resent on every question. Very large briefs retain a complete extractive outline.

Installed skill instructions are matched and loaded; arbitrary skill scripts and external connector capabilities are not automatically executed. This is a local workspace without authenticated multi-user isolation. NVIDIA model outages can still cause a clear failure when all recovery models are unavailable. Superiority to DeepSeek Harness has not been benchmarked.

The synthetic API-suite workspaces were cleaned up. One browser test file and one custom verification agent remain in the isolated browser origin for review. Existing user files and source changes were preserved.

## Head Agent and responsiveness update

The default entry is Head Agent chat. Head chat can list and assign actual tasks to built-in and custom agents, synthesize their returned answers, and cancel the shared run. Four assignments per turn and one delegation level bound execution. Child agents inherit the request provider/key and selected-file grounding.

New automated checks simulate elapsed time: requests survive 21 seconds, and silent NVIDIA requests abort at 60 seconds before same-key model recovery. They also verify actual child calls, synthesis context, custom-agent sanitization, recursive-delegation prevention, and exclusion of outside tools in delegated document mode.

Mobile navigation exposes agents, rooms, the library, and new chat. The composer stays visible while conversation messages scroll. Scrolling up suspends automatic output following. Room participants remain configurable on tablet and mobile.
