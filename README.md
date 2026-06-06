# Mukul AI — RAG-Powered Portfolio Assistant

A production-grade AI assistant that answers questions about Mukul Sharma's qualifications, projects, and experience. Built for the **Scaler AI Engineer Intern** evaluation.

**Live:** [mukul-ai.vercel.app](https://mukul-ai.vercel.app) &nbsp;|&nbsp; **Portfolio:** [mukul-sharma-dev.vercel.app](https://mukul-sharma-dev.vercel.app)

---

## What It Does

| Capability | Details |
|-----------|---------|
| **Resume Q&A** | Answers about education, experience, skills, achievements — grounded in actual resume data |
| **Project deep-dive** | Tech stack, purpose, design tradeoffs, what Mukul would do differently — from real GitHub READMEs |
| **Commit history** | Fetches live commit history + file diffs from GitHub API on demand |
| **Calendar booking** | Checks Mukul's Google Calendar availability and books calls directly from chat |
| **Interview mode** | Responds as Mukul in first-person for mock recruiter interviews |
| **Adversarial resilience** | Stays grounded — no hallucination, no prompt injection |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                     │
│   Chat UI  ←→  bookingState (React)  ←→  /api/chat         │
└────────────────────────┬────────────────────────────────────┘
                         │ POST /api/chat
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Chat API Route                            │
│                                                              │
│  1. Calendar State Machine?  ──yes──→ Google Calendar API   │
│           │ no                                               │
│  2. Commit Question?  ────────yes──→ GitHub REST API        │
│           │ no                                               │
│  3. RAG Pipeline                                             │
│     ├── Query Embedding (Ollama / HuggingFace)              │
│     ├── Vector Search (MongoDB cosine similarity)           │
│     ├── Resume sections (always included)                   │
│     └── Top-k project chunks                                │
│           │                                                  │
│  4. LLM Generation (fallback chain)                         │
│     Ollama (8s) → Groq API 1 → Groq API 2 → Gemini 2.5    │
└─────────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   MongoDB Atlas    Google Calendar   GitHub API
   (Vector Store)   (Free/Busy + Book) (Commits + Diffs)
```

### RAG Pipeline Detail

```
Ingest (offline):
  resume.txt ──→ section parser ──→ chunks
  projects.txt ──→ project parser ──→ per-project chunks
  GitHub READMEs ──→ fetched via API ──→ chunked
        │
        ▼ embed (nomic-embed-text via Ollama)
        ▼ store in MongoDB {content, embedding, metadata}

Query (runtime):
  User question
       │
       ▼ embed query (Ollama → HuggingFace fallback)
       ▼ cosine similarity against all chunks
       ▼ top-8 results + all resume sections
       ▼ inject as context into LLM prompt
       ▼ LLM generates grounded answer
```

### Calendar Booking State Machine

```
trigger ("is mukul free", "book a call", etc.)
       │
       ▼
   NEED_DATE ──→ ask for date ──→ show available slots
       │
       ▼
   NEED_TIME ──→ user picks time
       │
       ▼
   NEED_NAME ──→ user gives name (+ optional email)
       │
       ▼
   CONFIRM ──→ "yes" → bookAppointment() → Google Calendar
              "no"  → cancelled
```

State is stored on the **frontend** (`bookingState`) and passed with each request — no session storage needed, fully stateless backend.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Frontend | React 19, Tailwind CSS v4, react-markdown |
| Database | MongoDB Atlas (vector store) |
| Embeddings | Ollama `nomic-embed-text` → HuggingFace fallback |
| LLM | Ollama `llama3` → Groq `llama-3.3-70b` → Gemini 2.5 Flash |
| Calendar | Google Calendar API (Service Account) |
| GitHub | GitHub REST API (commit history + diffs) |
| Deployment | Vercel |

---

## Project Structure

```
mukul-ai/
├── app/
│   ├── api/
│   │   ├── chat/route.ts              # Main chat endpoint (RAG + calendar + commits)
│   │   ├── documents/route.ts         # Document CRUD
│   │   ├── documents/ingest/route.ts  # Ingestion stats
│   │   ├── documents/upload/route.ts  # File upload endpoint
│   │   ├── calendar/availability/     # GET free slots
│   │   ├── calendar/book/             # POST book event
│   │   ├── github-repo-commit/        # POST fetch commit history
│   │   └── debug/route.ts             # DB stats
│   ├── components/
│   │   └── NeonBackground.tsx         # Canvas wave animation
│   ├── page.tsx                       # Chat UI
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── mongodb.ts                     # MongoDB client (singleton)
│   ├── embeddings.ts                  # Ollama → HuggingFace embedding
│   ├── calendar.ts                    # Google Calendar helpers
│   ├── github.ts                      # GitHub API helpers
│   └── vector-db.ts                   # Vector search utilities
├── scripts/
│   ├── ingest-data.ts                 # Ingest resume + projects → MongoDB
│   ├── ingest-github.ts               # Fetch GitHub READMEs → MongoDB
│   └── clean-data.ts                  # Wipe all vectors
├── data/
│   ├── resume.txt
│   ├── projects.txt
│   └── project_link                   # JSON list of repos
├── instrumentation.ts                 # Startup env check + DNS config
└── .env.local                         # Environment variables
```

---

## Setup

### Prerequisites

- Node.js 18+
- MongoDB Atlas cluster
- Ollama running locally (`ollama pull nomic-embed-text && ollama pull llama3`)
- Groq API keys (free at [console.groq.com](https://console.groq.com))
- Google Cloud service account with Calendar API enabled

### Install

```bash
git clone https://github.com/mukul-sharma-tech/mukul-ai
cd mukul-ai
npm install
```

### Environment Variables

Create `.env.local`:

```env
# MongoDB (direct connection — avoids SRV DNS issues)
MONGO_URI="mongodb://user:pass@host1:27017,host2:27017,host3:27017/mukul-ai?ssl=true&replicaSet=...&authSource=admin"

# LLM fallback chain
Groq_API_1="gsk_..."
Groq_API_2="gsk_..."
gemini_api="AI..."

# Embeddings fallback (for cloud deployment)
HF_TOKEN="hf_..."
HF_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2

# Google Calendar (paste entire service account JSON as one line)
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"..."}'

# GitHub (optional — increases rate limit from 60 to 5000/hr)
# GITHUB_TOKEN=ghp_...
```

### Ingest Data

```bash
# Start dev server first
npm run dev

# In another terminal — ingest resume + projects
npm run ingest

# Ingest GitHub READMEs (optional but recommended)
npm run ingest:github

# Clean all vectors
npm run clean
```

### Run

```bash
npm run dev    # development
npm run build  # production build
npm run start  # production server
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in Vercel
3. Add all environment variables from `.env.local` in Vercel Settings → Environment Variables
4. For `GOOGLE_SERVICE_ACCOUNT_JSON` — paste the entire JSON as one minified line:
   ```powershell
   # Generate minified JSON (PowerShell)
   (Get-Content "data\mukul-ai-c90455154a6f.json" -Raw) | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 10
   ```
5. Deploy — check Vercel Logs after first request to verify env check output

---

## API Reference

### `POST /api/chat`
```json
{
  "message": "Why are you fit for this role?",
  "conversationHistory": [],
  "bookingState": null
}
```
Response:
```json
{
  "success": true,
  "response": "Mukul has ...",
  "bookingState": null
}
```

### `POST /api/documents`
```json
{ "content": "Resume text...", "metadata": { "type": "resume" } }
```

### `GET /api/calendar/availability?date=2026-06-10`
```json
{ "date": "2026-06-10", "availableSlots": ["10:00 AM IST", "2:00 PM IST"] }
```

### `POST /api/github-repo-commit`
```json
{ "project": "agento" }
```

---

## LLM Fallback Chain

```
1. Ollama llama3 (local, 8s timeout)
        ↓ fails
2. Groq llama-3.3-70b-versatile (API 1)
        ↓ fails / rate limited
3. Groq llama-3.3-70b-versatile (API 2)
        ↓ fails
4. Gemini 2.5 Flash
        ↓ fails
Error: All providers failed
```

---

## Embedding Fallback

```
Ollama nomic-embed-text (local)
        ↓ unavailable on cloud
HuggingFace sentence-transformers/all-MiniLM-L6-v2
```

> **Note:** If you re-ingest using HuggingFace embeddings (384 dims), all previously stored Ollama embeddings (768 dims) must be cleared first (`npm run clean`) since dimension mismatch breaks cosine similarity.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run ingest` | Ingest resume + projects into MongoDB |
| `npm run ingest:github` | Fetch + ingest GitHub READMEs |
| `npm run clean` | Delete all vectors from MongoDB |

---

*Built by Mukul Sharma · [GitHub](https://github.com/mukul-sharma-tech) · [LinkedIn](https://linkedin.com/in/mukul-sharma1010)*
