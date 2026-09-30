# Verification — 1 October 2026

The current Hanjra branch passed `npm run verify`: TypeScript, ESLint, and
121 tests. `npm run build` completed the optimized production build, including
the Hanjra console and intelligence routes. The build still emits a LlamaIndex
duplicate-import warning. These checks do not establish all external adapters
or a complete autonomous operating system.

## Run and reproduce

Use Node.js 22.6+ and `npm ci`. Copy `.env.example` to `.env.local` and
configure the provider you want to use. For the local command console, review
`docs/HANJRA.md` and `.env.hanjra.example`, then run `npm run hanjra`.
The console is available at `http://127.0.0.1:3013/hanjra`.

GitHub CI runs the same verification command and a production build on main,
Codex branches, and pull requests targeting main. Local runtime databases,
voice fixtures, screenshots, acceptance logs, and backups are excluded from
the new commit. Source, tests, configuration examples, and architectural
documentation are included.

## Remaining product work

The working local core includes persistent tasks, explicit policies, learning
reviews, and console routes. Mail/calendar send adapters, generic software
fix/PR execution, real revenue verification, production scheduling, and
several multilingual speech integrations remain incomplete or unverified.
Do not infer live integration success from mocked contract tests. The prior
capability report remains local under `artifacts/hanjra/`.
