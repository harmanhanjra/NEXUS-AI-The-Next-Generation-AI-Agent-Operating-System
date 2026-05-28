# 🧠 Nexus AI — The Next-Generation AI Agent Operating System

> A unified AI operating system where humans and autonomous AI agents work side-by-side across web, mobile, and cloud — replacing dozens of SaaS tools with a single intelligent workspace.

<p align="center">
  <strong>Created by <a href="https://github.com/harmanhanjra">Harman Hanjra</a></strong>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fharmanhanjra%2FNEXUS-AI-The-Next-Generation-AI-Agent-Operating-System&env=GEMINI_API_KEY&envDescription=Free%20Gemini%20API%20key%20from%20Google%20AI%20Studio&envLink=https%3A%2F%2Faistudio.google.com%2Fapikey">
    <img src="https://vercel.com/button" alt="Deploy with Vercel" />
  </a>
</p>

A production-grade AI agent platform powered by **Google Gemini**, deployable to Vercel in **under 2 minutes**.

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

### Option A — One-click deploy
Click the "Deploy with Vercel" button above. You'll be prompted to add `GEMINI_API_KEY` (optional — users can paste their own).

### Option B — Vercel CLI
```bash
npm install -g vercel
vercel
# Follow prompts → done!
```

### Option C — Vercel Dashboard
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import this repository
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
git clone https://github.com/harmanhanjra/NEXUS-AI-The-Next-Generation-AI-Agent-Operating-System.git
cd NEXUS-AI-The-Next-Generation-AI-Agent-Operating-System
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
.
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
  "apiKey": "AIza..."
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

## 👤 Author

**Harman Hanjra**
- GitHub: [@harmanhanjra](https://github.com/harmanhanjra)
- Repo: [NEXUS-AI](https://github.com/harmanhanjra/NEXUS-AI-The-Next-Generation-AI-Agent-Operating-System)

---

## 🪪 License

[MIT](LICENSE) © 2026 Harman Hanjra

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/harmanhanjra">Harman Hanjra</a>
</p>
