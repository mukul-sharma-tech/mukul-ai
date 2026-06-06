import { NextRequest, NextResponse } from 'next/server';
import { getChunksCollection } from '@/lib/mongodb';
import { generateEmbedding } from '@/lib/embeddings';
import { getCommitHistory } from '@/lib/github';
import { getAvailableSlots, bookAppointment } from '@/lib/calendar';
import ollama from 'ollama';
import { GoogleGenAI } from '@google/genai';

const LLM_MODEL = 'llama3';

// ── LLM providers ─────────────────────────────────────────
async function callGroq(apiKey: string, messages: { role: string; content: string }[]): Promise<string> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.3, max_tokens: 512 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
    return (await res.json()).choices?.[0]?.message?.content || '';
  } catch (err) { clearTimeout(timer); throw err; }
}

async function callGemini(apiKey: string, messages: { role: string; content: string }[]): Promise<string> {
  const ai        = new GoogleGenAI({ apiKey });
  const systemMsg = messages.find(m => m.role === 'system');
  const contents  = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: { systemInstruction: systemMsg?.content, maxOutputTokens: 512, temperature: 0.3 },
  });
  return response.text ?? '';
}

async function generateResponse(messages: { role: string; content: string }[]): Promise<string> {
  // 1. Ollama (local, 8s)
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 8000);
    const res  = await ollama.chat({ model: LLM_MODEL, messages, stream: false });
    clearTimeout(t);
    if (res.message.content?.trim()) return res.message.content;
  } catch (e) { console.warn('Ollama:', e instanceof Error ? e.message : e); }

  // 2. Groq 1
  if (process.env.Groq_API_1) {
    try { const c = await callGroq(process.env.Groq_API_1, messages); if (c?.trim()) return c; }
    catch (e) { console.warn('Groq1:', e instanceof Error ? e.message : e); }
  }

  // 3. Groq 2
  if (process.env.Groq_API_2) {
    try { const c = await callGroq(process.env.Groq_API_2, messages); if (c?.trim()) return c; }
    catch (e) { console.warn('Groq2:', e instanceof Error ? e.message : e); }
  }

  // 4. Gemini
  if (process.env.gemini_api) {
    try { const c = await callGemini(process.env.gemini_api, messages); if (c?.trim()) return c; }
    catch (e) { console.warn('Gemini:', e instanceof Error ? e.message : e); }
  }

  throw new Error('All LLM providers failed');
}

// ── Calendar booking state machine ────────────────────────
// bookingState is passed in the request body from the frontend
// States: null | 'NEED_DATE' | 'NEED_TIME' | 'NEED_NAME' | 'CONFIRM'

interface BookingState {
  step:  'NEED_DATE' | 'NEED_TIME' | 'NEED_NAME' | 'CONFIRM';
  date?: string;
  time?: string;
  name?: string;
  email?: string;
}

// Trigger words to START the booking flow
const CALENDAR_TRIGGERS = [
  'available', 'availability', 'free slot', 'free time', 'book a call',
  'book a meeting', 'book a slot', 'schedule a call', 'schedule a meeting',
  'book call', 'check calendar', 'is mukul free', 'mukul free',
];

function triggersCalendar(msg: string): boolean {
  const l = msg.toLowerCase();
  return CALENDAR_TRIGGERS.some(k => l.includes(k));
}

function extractDate(msg: string): string | null {
  const lower = msg.toLowerCase();
  const now   = new Date();
  if (lower.includes('today'))    return now.toISOString().split('T')[0];
  if (lower.includes('tomorrow')) {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    return t.toISOString().split('T')[0];
  }
  const iso = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const months: Record<string, number> = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
  const m1 = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/);
  const m2 = lower.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if (m1) return `${now.getFullYear()}-${String(months[m1[1]]).padStart(2,'0')}-${m1[2].padStart(2,'0')}`;
  if (m2) return `${now.getFullYear()}-${String(months[m2[2]]).padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  return null;
}

function extractTime(msg: string): string | null {
  const withAmPm = msg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)\b/);
  if (withAmPm) return `${withAmPm[1]}:${withAmPm[2] || '00'} ${withAmPm[3].toUpperCase()}`;
  // "after 12pm" → take the time part
  const after = msg.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)\b/i);
  if (after) return `${after[1]}:${after[2] || '00'} ${after[3].toUpperCase()}`;
  const h24 = msg.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24) return `${h24[1]}:${h24[2]}`;
  return null;
}

function extractEmail(msg: string): string | null {
  const m = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

function extractName(msg: string): string | null {
  // "my name is X" or "I'm X"
  const exp = msg.match(/(?:my name is|i'm|i am|name[:\s]+)\s*([A-Za-z][a-zA-Z\s]{1,30}?)(?:\s*,|\s*$)/i);
  if (exp) return exp[1].trim();
  // standalone single/double word name (capital start, no digits)
  const single = msg.trim().match(/^([A-Z][a-z]{1,}(?:\s[A-Z][a-z]{1,})?)$/);
  if (single) return single[1];
  return null;
}

function parseTimeToISO(date: string, time: string): string {
  const isPM  = /PM/i.test(time);
  const isAM  = /AM/i.test(time);
  const clean = time.replace(/\s?(IST|AM|PM)/gi, '').trim();
  let [h, m]  = clean.split(':').map(n => parseInt(n) || 0);
  if (isPM && h !== 12) h += 12;
  if (isAM && h === 12) h = 0;
  let utcH = h - 5, utcM = m - 30;
  if (utcM < 0) { utcM += 60; utcH--; }
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCHours(utcH, utcM, 0, 0);
  return dt.toISOString();
}

async function handleBookingState(
  message: string,
  state: BookingState,
): Promise<{ response: string; newState: BookingState | null }> {
  const lower = message.toLowerCase().trim();

  // ── NEED_DATE step ────────────────────────────────────
  if (state.step === 'NEED_DATE') {
    const date = extractDate(message);
    if (!date) return { response: `What date works? (e.g. "tomorrow", "June 10")`, newState: state };

    const slots = await getAvailableSlots(date).catch(() => [] as string[]);
    if (!slots.length) {
      return { response: `Mukul is fully booked on **${date}**. Try another date?`, newState: state };
    }
    return {
      response: `Here are Mukul's open slots on **${date}** (IST):\n\n${slots.slice(0,8).map(s => `- ${s}`).join('\n')}\n\nWhich time works?`,
      newState: { ...state, step: 'NEED_TIME', date },
    };
  }

  // ── NEED_TIME step ────────────────────────────────────
  if (state.step === 'NEED_TIME') {
    const time = extractTime(message);
    if (!time) return { response: `What time? (e.g. "2 PM", "10:30 AM")`, newState: state };
    return {
      response: `Got it — **${time}** on **${state.date}**. What's your name?`,
      newState: { ...state, step: 'NEED_NAME', time },
    };
  }

  // ── NEED_NAME step ────────────────────────────────────
  if (state.step === 'NEED_NAME') {
    const email = extractEmail(message);
    const name  = extractName(message) || (message.trim().length < 40 && !/\d/.test(message) ? message.trim() : null);
    if (!name) return { response: `What's your name?`, newState: state };
    return {
      response: `**${name}** — booking call on **${state.date}** at **${state.time}** IST.\n\nConfirm? (yes / no)${email ? '' : '\n\nAlso share your email to get a confirmation.'}`,
      newState: { ...state, step: 'CONFIRM', name, email: email || undefined },
    };
  }

  // ── CONFIRM step ──────────────────────────────────────
  if (state.step === 'CONFIRM') {
    if (['no', 'cancel', 'nope', 'stop'].includes(lower)) {
      return { response: `No problem — booking cancelled. Let me know if you want to reschedule.`, newState: null };
    }

    if (['yes', 'ok', 'sure', 'confirm', 'yeah', 'yep', 'go ahead', 'book it', 'book'].includes(lower) || lower.includes('yes') || lower.includes('confirm')) {
      try {
        const startISO = parseTimeToISO(state.date!, state.time!);
        const endISO   = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();
        const event    = await bookAppointment(
          `Call with ${state.name}`,
          `Booked via Mukul's AI Assistant\nName: ${state.name}${state.email ? `\nEmail: ${state.email}` : ''}`,
          startISO, endISO, undefined,
        );
        return {
          response: `✅ **Call booked!**\n\n- **Date:** ${state.date}\n- **Time:** ${state.time} IST\n- **Name:** ${state.name}\n${state.email ? `- **Email:** ${state.email}\n` : ''}\n[View in Calendar](${event.htmlLink})\n\nMukul will connect with you then!`,
          newState: null,
        };
      } catch (err: any) {
        return { response: `Booking failed: ${err.message}. Please try again.`, newState: null };
      }
    }

    // User gave extra info (email) before confirming
    const email = extractEmail(message);
    if (email) {
      return {
        response: `Got your email. Confirm booking for **${state.date}** at **${state.time}** IST for **${state.name}**?`,
        newState: { ...state, email },
      };
    }

    return { response: `Please confirm with "yes" to book, or "no" to cancel.`, newState: state };
  }

  return { response: `Something went wrong. Say "book a call" to start over.`, newState: null };
}

// ── GitHub commits ────────────────────────────────────────
const COMMIT_KEYWORDS = ['commit', 'last commit', 'recent commit', 'latest commit', 'commit history', 'last update', 'recently updated', 'last pushed'];
const KNOWN_PROJECTS  = ['agento','ai-hire','edunitex','orbital creeper shield','sanskritam','knox neural shield','agenticiq','synapsee','circularchain','fluxmeter','switch','querygenius','ulkadrishti','astro-cadet','gigflow','ai gossip hub','rfp-optimize','chakra'];

function isCommitQuestion(msg: string)  { return COMMIT_KEYWORDS.some(k => msg.toLowerCase().includes(k)); }
function extractProjectName(msg: string) { return KNOWN_PROJECTS.find(p => msg.toLowerCase().includes(p)) || null; }

// ── Vector search ─────────────────────────────────────────
async function vectorSearch(query: string, limit = 8) {
  try {
    const qEmb = await generateEmbedding(query);
    const col  = await getChunksCollection();
    if (await col.countDocuments() === 0) return [];
    const docs = await col.find({}).toArray();
    return docs
      .map(d => ({ content: d.content as string, metadata: d.metadata, score: cosineSimilarity(qEmb, d.embedding ?? []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch { return []; }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// ── System prompt ─────────────────────────────────────────
const JOB_DESCRIPTION = `Scaler 3.0 — India's first fully AI-native EdTech. Needs: autonomous agents, LangGraph/LangChain pipelines, production Python (async/typed), Voice AI (Vapi/ElevenLabs), RAG. Stipend ₹55k, 6-month, PPO.`;

function buildSystemPrompt(): string {
  return `You are Mukul's AI assistant. Speak concisely and professionally.

- Greeting/small talk → 1-2 warm sentences.
- "interview mukul" → say "Sure! Ask away — I'll answer as Mukul."
- Interview questions → answer AS Mukul, first person, 3-5 sentences, facts only.
- Skills/projects/experience → answer from context ONLY. If missing: "Reach Mukul at muku0784@gmail.com".
- Calendar/booking → handled separately. Do NOT attempt to book — just acknowledge if asked.

Rules: no tables, bullets ≤8 words, ≤150 words, bold key terms, backtick tech, no <br>.
Only mention real projects from context.
Scaler role: ${JOB_DESCRIPTION}`;
}

// ── POST handler ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationHistory = [], bookingState = null } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // ── Active booking state machine ──────────────────────
    if (bookingState) {
      const { response, newState } = await handleBookingState(message, bookingState);
      return NextResponse.json({ success: true, response, bookingState: newState });
    }

    // ── Trigger new booking flow ──────────────────────────
    if (triggersCalendar(message)) {
      const date = extractDate(message);
      if (date) {
        const slots = await getAvailableSlots(date).catch(() => [] as string[]);
        if (!slots.length) {
          return NextResponse.json({
            success: true,
            response: `Mukul is fully booked on **${date}**. Try another date?`,
            bookingState: { step: 'NEED_DATE' },
          });
        }
        return NextResponse.json({
          success: true,
          response: `Here are Mukul's open slots on **${date}** (IST):\n\n${slots.slice(0,8).map(s => `- ${s}`).join('\n')}\n\nWhich time works?`,
          bookingState: { step: 'NEED_TIME', date },
        });
      }
      return NextResponse.json({
        success: true,
        response: `Sure! What date works for you?`,
        bookingState: { step: 'NEED_DATE' },
      });
    }

    // ── Commit question ───────────────────────────────────
    if (isCommitQuestion(message)) {
      const proj = extractProjectName(message);
      if (proj) {
        const info = await getCommitHistory(proj).catch(() => null);
        if (info) return NextResponse.json({ success: true, response: info });
      }
    }

    // ── RAG + LLM ─────────────────────────────────────────
    const relevantDocs = await vectorSearch(message, 8);
    const col          = await getChunksCollection();
    const resumeDocs   = await col.find({ 'metadata.type': { $regex: '^resume' } }, { projection: { embedding: 0 } }).toArray();

    const resumeCtx  = resumeDocs.map(d => `[${d.metadata?.section || d.metadata?.type}]\n${d.content}`).join('\n\n');
    const resumeIds  = new Set(resumeDocs.map(d => String(d._id)));
    const projectCtx = relevantDocs
      .filter(d => !resumeIds.has(String(d.metadata?._id)) && !String(d.metadata?.type).startsWith('resume'))
      .map(d => d.content).join('\n\n').slice(0, 2000);

    let ctx = '';
    if (resumeCtx)  ctx += `=== RESUME ===\n${resumeCtx}\n\n`;
    if (projectCtx) ctx += `=== PROJECTS ===\n${projectCtx}`;
    if (!ctx.trim()) ctx = 'No relevant context found.';

    const msgs = [
      { role: 'system', content: buildSystemPrompt() },
      ...conversationHistory.slice(-4),
      { role: 'user',   content: `Context:\n${ctx}\n\n---\nQuestion: ${message}` },
    ];

    console.log(`[Chat] ~${Math.ceil(msgs.reduce((s,m) => s + m.content.length, 0) / 4)} tokens`);
    const responseText = await generateResponse(msgs);
    return NextResponse.json({ success: true, response: responseText, bookingState: null });

  } catch (error) {
    console.error('Error in chat:', error);
    return NextResponse.json(
      { error: 'Failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
