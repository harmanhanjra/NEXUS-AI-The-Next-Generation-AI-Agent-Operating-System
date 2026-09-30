# Hanjra and Nexus interface redesign

30 September 2026

## Scope

Both frontend routes now use a shared design system: `/` for solo chat, team rooms, agent configuration, files, skills, and provider settings; `/hanjra` for voice commands, persisted tasks, outcomes, evidence, and specialist availability. Backend adapter permissions and provider configuration are retained.

## References reviewed

| Repository or documentation | Reason for choosing it | Applied pattern |
| --- | --- | --- |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | React chat primitives with attention to streaming, attachments, keyboard access, and message composition | Focused conversation surface, a clear composer, source and tool information close to messages |
| [LobeHub](https://github.com/lobehub/lobehub) | Agent-centered workspace organization and explicit configuration surfaces | Searchable specialist registry and a clear path between specialist chat and collaborative rooms |
| [Open WebUI](https://github.com/open-webui/open-webui) | A broad local/model-compatible interface with knowledge and provider organization | Files, skills, provider settings, and conversation navigation remain reachable from the main workspace |
| [shadcn sidebar documentation](https://ui.shadcn.com/docs/components/base/sidebar) | Composable application navigation and responsive sidebar structure | A stable navigation rail on desktop, compact view selection on mobile, and quick navigation available at every size |
| [Taste Skill](https://www.tasteskill.dev/docs), [ThreeUI](https://threeui.com/), [21st.dev](https://21st.dev/), [GSAP](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/) | Earlier user-specified visual and motion references | Restrained dimensional identity, consistent shapes and accents, scoped motion, reduced-motion handling |

“Best” here means suited to this project's React stack and workflows, not a universal ranking. These projects are references; their backends and feature claims are not inherited by Hanjra. No third-party source or branding was copied. Open WebUI's current repository includes additional branding license requirements, so it was used for architectural reference only.

## Design decisions

- Slate surfaces, cyan accent, local system typography, a consistent spacing scale, and 8–16 px corner hierarchy.
- One token set for dark and light themes. Theme choice persists in browser storage and applies to both routes when opened.
- Main workspace separates navigation, page context, conversation, composition, and optional inspection. No decorative gradients behind reading surfaces.
- Hanjra becomes an operational console with a compact status core and command controls closer to the top. The particle scene is reduced on desktop and hidden on small screens.
- Status copy avoids presenting configured agents or selected room participants as proof of running or healthy services.

## UX changes

- Ctrl/Cmd + K opens searchable quick navigation. Enter opens the first match; Escape closes it.
- Search specialists by name, role, or responsibility.
- Search persisted tasks by command, owner, or state, combined with a status filter. Empty results have explicit guidance.
- Ctrl/Cmd + Enter runs a typed Hanjra command. Escape continues to stop capture and playback.
- A room setup dialog makes participant selection accessible at small widths.
- Dialog focus is contained, Escape closes, and focus returns to the trigger. Existing file, settings, skills, and agent dialogs use the shared behavior.
- Long voice instructions are disclosed on demand while device selection and microphone actions remain directly accessible.
- Desktop and mobile navigation connect the voice console and Nexus workspace.

## Verification

- Automated suite: 114 tests passed, zero failures. Type checking, lint, and an isolated production build passed. The build retains the existing llamaindex duplicate-import warning.
- Browser: specialist search, configuration dialogs, Escape dismissal, focus cycling, quick navigation, room participant setup, file and skill dialogs, and light/dark themes were exercised.
- Workspace layout: document width stayed within the viewport at 320, 768, 1024, and 1440 pixels. Console desktop layout measured 1430 pixels within a 1440-pixel viewport. Console breakpoint changes and viewport reset timed out in the browser controller; its complete mobile verification remains outstanding.
- Console: an unmatched task search showed the explicit empty state; Completed filtering excluded failed and awaiting-input tasks. Ctrl+Enter submitted a real status command, which appeared as completed at 08:02:40 with the saved task count increasing from 31 to 32. Automatic speech was restored after the test. No console errors were captured in the final error-log check.
- Screenshots: `artifacts/hanjra/nexus-redesign-desktop.png` and `artifacts/hanjra/console-redesign.png`.

The redesign does not certify physical microphone capture or Hindi/Punjabi speech synthesis.
