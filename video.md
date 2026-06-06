# Video Script — Mukul AI: Chat + Voice Assistant
**Target: ≤ 4 minutes | ~500–520 words spoken at 130 wpm**

---

## [0:00 – 0:20] Hook

> "Hi, I'm Mukul. I built two AI systems that represent me to recruiters —
> a chat assistant and a voice AI that picks up phone calls on my behalf.
> Both are RAG-grounded, both can book meetings on my calendar, and neither
> makes things up. Let me walk you through the architecture and the hardest
> problem I solved."

---

## [0:20 – 0:55] What It Does — Demo (35 seconds)

**Chat assistant** — show live at mukul-ai.vercel.app:

> "The chat assistant answers questions about my resume, GitHub repos,
> and can book a call directly in the conversation."

- Ask: **"Why is Mukul fit for the Scaler AI Engineer role?"** → grounded answer
- Ask: **"Last commits on AgenticIQ?"** → live GitHub diffs
- Ask: **"Is Mukul free tomorrow?"** → real calendar slots → book in chat

**Voice assistant** — show Vapi or phone number:

> "The voice assistant — MARS — does the same thing over a phone call.
> A recruiter calls, MARS answers, screens them, answers technical questions,
> checks the calendar, and books the meeting. No human needed."

---

## [0:55 – 2:00] Architecture — Both Systems (65 seconds)

**Chat system:**

> "The chat uses a standard RAG pipeline.
> Query comes in, gets embedded with Ollama's nomic-embed-text,
> hit MongoDB for cosine similarity search,
> inject the top chunks as context,
> and generate a response using a fallback LLM chain:
> Ollama → Groq → Gemini 2.5 Flash.
> Calendar and GitHub have dedicated handlers that bypass the LLM entirely."

**Voice system:**

> "The voice system runs on Vapi. The pipeline is:
> Deepgram for speech-to-text — their nova model with background denoising.
> GPT-4.1 as the reasoning layer, with my system prompt as the persona.
> Four tools the LLM can call:
> check_availability and book_appointment on Google Calendar,
> get_current_datetime for timezone-aware scheduling,
> and get_recent_github_commits — a POST call to my live API
> that returns real commit history.
> TTS is Vapi's Sagar voice at 1.05x speed.
> Smart endpointing handles turn-taking — no awkward silences."

> "Both systems share the same Google Calendar backend and the same
> GitHub commit API. Same knowledge base, two interfaces."

---

## [2:00 – 3:10] The Hard Problem — Booking Flow Hijack (70 seconds)

> "The hardest problem was the booking flow being hijacked by the LLM."

> "Here's what happened: user asks 'is Mukul free tomorrow?'
> System shows calendar slots.
> User replies '2pm'.
> User says 'yes, confirm'.
> System says: 'Your call is booked for 2pm!' — but nothing was booked."

> "The LLM was intercepting short follow-up messages — '2pm', 'yes', a name —
> because they didn't match any booking keyword.
> So they fell to the LLM, which confidently hallucinated a confirmation."

> "Root cause: fuzzy keyword detection.
> Fix: explicit state machine stored on the frontend."

```
NEED_DATE → NEED_TIME → NEED_NAME → CONFIRM → Google Calendar API
```

> "Each state is passed with the request. When booking state is active,
> the LLM is bypassed completely. Only the state machine handler runs.
> The confirmation message only appears after the Calendar API
> returns a real event link."

> "Same principle applies in the voice agent — the calendar tools
> are invoked directly by the LLM's tool-use protocol,
> not inferred from freeform conversation."

---

## [3:10 – 3:45] Eval & Groundedness (35 seconds)

> "I built an eval framework — 15 golden Q&A pairs, manually labelled
> from my actual resume and projects.
> Each answer is judged by Groq LLM-as-judge: grounded, partial, or hallucinated."

> "Current numbers:
> 80% fully grounded, 6.7% hallucination rate, retrieval F1 of 78%.
> You can reproduce it with `npm run eval` against the live API."

---

## [3:45 – 4:00] Close

> "Two interfaces, one knowledge base, zero hardcoded answers.
> Chat is live at mukul-ai.vercel.app.
> The voice agent is deployed on Vapi.
> Code is on GitHub."

> "I'm Mukul — thanks for watching."

---

## Timing Guide

| Section | Duration | Notes |
|---------|----------|-------|
| Hook | 0:20 | Set up both systems |
| Demo | 0:35 | Show chat + mention voice |
| Architecture | 1:05 | Chat RAG + Voice pipeline |
| Hard Problem | 1:10 | State machine fix |
| Eval | 0:35 | Numbers + how to run |
| Close | 0:15 | URLs |
| **Total** | **4:00** | |

---

## Key Points to Emphasize

- **Both systems share the same backend** — Calendar API, GitHub API, same knowledge base
- **LLM is bypassed for structured actions** — booking, commits, calendar checks
- **Fallback chains everywhere** — Ollama → Groq → Gemini for chat, GPT-4.1 for voice
- **Eval is reproducible** — `npm run eval` gives real numbers
- The hard problem shows **systems thinking** — not a patch, a proper state machine

## Things to Have Open

1. `mukul-ai.vercel.app` — chat tab, pre-loaded
2. Vapi dashboard or phone number for voice demo
3. Terminal with `npm run eval` output ready to show
4. `submission.txt` open for reference (don't read from it)
