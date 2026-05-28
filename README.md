# 🧠 Nexus AI — Vercel-Ready

A production-grade AI agent platform powered by **Google Gemini**, deployable to Vercel in **under 2 minutes**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYOUR_USERNAME%2Fnexus-ai&env=GEMINI_API_KEY&envDescription=Free%20Gemini%20API%20key%20from%20Google%20AI%20Studio&envLink=https%3A%2F%2Faistudio.google.com%2Fapikey)

> Replace `YOUR_USERNAME/nexus-ai` in the URL above after pushing to GitHub.

---

## ✨ Features

- 🤖 **5 specialized AI agents** with smart per-agent model routing
- ⚡ **Real-time SSE streaming** — token-by-token responses
- 🔍 **Google Search grounding** with real source citations (Research + Business agents)
- 🧠 **Semantic memory** via `gemini-embedding-001` (in-memory, resets on cold start)
- 🎨 **Premium UI** — glassmorphism, aurora background, animations
- 🔐 **Flexible API keys** — server env var OR user-pasted (localStorage)
- 📱 **Mobile responsive**

---

## 🚀 Deploy to Vercel (3 ways)

### Option A — One-click deploy (after pushing to GitHub)
1. Push this folder to a GitHub repo
2. Click the "Deploy with Vercel" button above
3. Optionally add `GEMINI_API_KEY` env var (users can paste their own otherwise)

### Option B — Vercel CLI (no GitHub needed)
```bash
npm install -g vercel
cd nexus-vercel
vercel
# Follow prompts → done!
```

### Option C — Vercel Dashboard upload
1. Go to [vercel.com/new](https://vercel.com/new)
2. Drag this folder, or "Import Git Repository"
3. Click **Deploy** — no env vars required

---

## 🔑 Getting a Gemini API Key (free)

1. Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click "Create API key"
3. Copy the key (starts with `AIza...`)

You can either:
- **Set it server-side**: Add `GEMINI_API_KEY` env var in Vercel project settings
- **Let users paste their own**: They click Settings in the UI and store it in their browser

---

## 💻 Run Locally

```bash
npm install
cp .env.example .env.local
# Add your GEMINI_API_KEY to .env.local (optional)
npm run dev
# → http://localhost:3000
```

---

## 🤖 The Agents

| Agent | Model | Tools | Style |
|---|---|---|---|
| 🔬 **Research** | `gemini-2.5-flash` | Google Search + Memory | Cites sources, structured |
| 💻 **Coding** | `gemini-2.5-pro` (2M ctx) | Memory | Production-quality TypeScript |
| ✍️ **Content** | `gemini-2.5-flash` | Memory | Punchy, varied prose |
| 📊 **Business** | `gemini-2.5-pro` | Google Search + Memory | TL;DR + frameworks |
| 🌱 **Life Coach** | `gemini-2.5-flash` | Memory | Empathic, practical |

Customize agents in [`lib/agents.ts`](lib/agents.ts).

---

## 📁 Project Structure

```
nexus-vercel/
├── app/
│   ├── api/
│   │   ├── chat/route.ts          ← SSE streaming endpoint
│   │   ├── conversations/route.ts ← Chat history
│   │   ├── memory/route.ts        ← Memory CRUD
│   │   └── health/route.ts        ← Status check
│   ├── globals.css                ← Design system
│   ├── layout.tsx
│   └── page.tsx                   ← React client app
├── lib/
│   ├── agents.ts                  ← Agent registry + prompts
│   ├── llm.ts                     ← Gemini streaming + orchestration
│   ├── memory.ts                  ← In-memory store (swap for Postgres in prod)
│   └── markdown.ts                ← Zero-dep markdown renderer
├── vercel.json                    ← Vercel config (60s max for chat)
└── package.json
```

---

## ⚠️ Important: Memory & Persistence

This deploy uses **in-memory storage** that resets when Vercel's serverless function goes cold (typically every ~5 minutes of inactivity). This is perfect for demos and personal use.

### Upgrade to persistent storage:

For production, swap `lib/memory.ts` for one of:

**Option 1 — Vercel Postgres (recommended)**
```bash
vercel postgres create
# Auto-injects POSTGRES_URL into your env
```
Then update `lib/memory.ts` to use `@vercel/postgres` with `pgvector` extension.

**Option 2 — Upstash Redis** (HTTP-based, edge-friendly)
```bash
# Create at upstash.com → copy REST URL + TOKEN
```

**Option 3 — Qdrant Cloud** (best for vector search at scale)

---

## 🛠 Tech Stack

- **Framework**: Next.js 15 (App Router, RSC)
- **Runtime**: Node.js serverless functions on Vercel
- **AI**: `@google/genai` SDK
- **Streaming**: Native Web Streams + SSE
- **Styling**: Pure CSS (no Tailwind dependency for portability)
- **TypeScript**: Strict mode

---

## 📡 API Reference

### `POST /api/chat`
Streams a Gemini response via SSE.

**Request:**
```json
{
  "agentId": "research",
  "conversationId": "abc123",
  "message": "What's new in AI?",
  "apiKey": "AIza..." // optional, overrides server key
}
```

**Stream events:**
```
event: thinking → "Searching memory…"
event: tool_call → {name, args, result, success}
event: token → "next word"
event: citation → [{n, title, uri}]
event: done → {text, tokens}
event: error → "message"
```

### `GET /api/conversations?agentId=research`
Lists recent conversations.

### `GET /api/conversations?conversationId=abc123`
Lists messages in a conversation.

### `GET /api/memory?agentId=research`
Lists memory chunks.

### `GET /api/health`
Returns `{ ok: true, hasServerKey: boolean }`.

---

## 🪪 License

MIT — do whatever you want.

---

Built with the [Nexus AI Blueprint](https://github.com/YOUR_USERNAME/nexus-ai). PRs welcome!
