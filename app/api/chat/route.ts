import { NextRequest, NextResponse } from 'next/server';
import { getChunksCollection } from '@/lib/mongodb';
import { generateEmbedding } from '@/lib/embeddings';
import { getCommitHistory } from '@/lib/github';
import { getAvailableSlots, bookAppointment } from '@/lib/calendar';
import ollama from 'ollama';
import { GoogleGenAI } from '@google/genai';

const LLM_MODEL = 'gpt-oss:20b-cloud';

// ── Groq ──────────────────────────────────────────────────
async function callGroq(
  apiKey: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.3,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Gemini fallback ───────────────────────────────────────
async function callGemini(
  apiKey: string,
  messages: { role: string; content: string }[],
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  // Separate system prompt from conversation
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs  = messages.filter(m => m.role !== 'system');

  // Map to Gemini content format
  const contents = chatMsgs.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const response = await ai.models.generateContent({
    model:  'gemini-2.5-flash',
    contents,
    config: {
      systemInstruction: systemMsg?.content,
      maxOutputTokens:   512,
      temperature:       0.3,
    },
  });

  return response.text ?? '';
}

async function generateResponse(
  messages: { role: string; content: string }[],
): Promise<string> {
  // 1. Ollama (local) — 8s timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await ollama.chat({ model: LLM_MODEL, messages, stream: false });
    clearTimeout(timer);
    const content = response.message.content;
    if (content?.trim()) return content;
    throw new Error('Empty response');
  } catch (err) {
    console.warn('Ollama failed, trying Groq:', err instanceof Error ? err.message : err);
  }

  // 2. Groq API 1
  const key1 = process.env.Groq_API_1;
  if (key1) {
    try {
      const content = await callGroq(key1, messages);
      if (content?.trim()) return content;
    } catch (err) {
      console.warn('Groq API 1 failed:', err instanceof Error ? err.message : err);
    }
  }

  // 3. Groq API 2
  const key2 = process.env.Groq_API_2;
  if (key2) {
    try {
      const content = await callGroq(key2, messages);
      if (content?.trim()) return content;
    } catch (err) {
      console.warn('Groq API 2 failed:', err instanceof Error ? err.message : err);
    }
  }

  // 4. Gemini 2.5 Flash
  const geminiKey = process.env.gemini_api;
  if (geminiKey) {
    try {
      console.log('Trying Gemini fallback...');
      const content = await callGemini(geminiKey, messages);
      if (content?.trim()) return content;
    } catch (err) {
      console.warn('Gemini failed:', err instanceof Error ? err.message : err);
    }
  }

  throw new Error('All LLM providers failed (Ollama, Groq1, Groq2, Gemini)');
}

// ── Calendar intent detection ─────────────────────────────
const AVAILABILITY_KEYWORDS = ['available', 'availability', 'free slot', 'free time', 'when can', 'book a call', 'book call', 'check calendar'];
const BOOKING_KEYWORDS = ['book', 'schedule a call', 'set up a call', 'confirm the call', 'reserve'];

function isAvailabilityQuestion(msg: string): boolean {
  return AVAILABILITY_KEYWORDS.some(k => msg.toLowerCase().includes(k));
}

function isBookingRequest(msg: string): boolean {
  return BOOKING_KEYWORDS.some(k => msg.toLowerCase().includes(k));
}

function extractDate(msg: string): string | null {
  const lower = msg.toLowerCase();
  const now = new Date();

  if (lower.includes('today'))    return now.toISOString().split('T')[0];
  if (lower.includes('tomorrow')) {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    return t.toISOString().split('T')[0];
  }

  const isoMatch = msg.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const months: Record<string, number> = {
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
  };
  const m1 = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/);
  const m2 = lower.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if (m1) return `${now.getFullYear()}-${String(months[m1[1]]).padStart(2,'0')}-${String(parseInt(m1[2])).padStart(2,'0')}`;
  if (m2) return `${now.getFullYear()}-${String(months[m2[2]]).padStart(2,'0')}-${String(parseInt(m2[1])).padStart(2,'0')}`;

  return null;
}

// Must have explicit AM/PM OR HH:MM format — avoids grabbing random numbers
function extractTime(msg: string): string | null {
  // "3 PM", "3pm", "3:00 PM", "15:00"
  const withAmPm = msg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)\b/);
  if (withAmPm) {
    const h = withAmPm[1];
    const m = withAmPm[2] || '00';
    const ap = withAmPm[3].toUpperCase();
    return `${h}:${m} ${ap}`;
  }
  // 24h "14:30"
  const h24 = msg.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24) return `${h24[1]}:${h24[2]}`;

  return null;
}

// Extract email
function extractEmail(msg: string): string | null {
  const m = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

// Extract name — from "book for TIME, NAME, EMAIL" pattern or explicit phrases
function extractName(msg: string): string | null {
  // Pattern: "book for X pm, Name, email" — name is between first comma and email/second comma
  const commaPattern = msg.match(/book[^,]+,\s*([^,@\n]+?)(?:,|\s+[a-zA-Z0-9._%+-]+@)/i);
  if (commaPattern) {
    const candidate = commaPattern[1].trim();
    // Reject if it looks like a time or contains digits
    if (candidate && !/\d/.test(candidate) && candidate.length < 40) return candidate;
  }

  // "my name is X", "I'm X", "name: X"
  const explicit = msg.match(/(?:my name is|i'm|i am|name[:\s]+)\s*([A-Za-z][a-z]+(?: [A-Za-z][a-z]+)?)/i);
  if (explicit) return explicit[1].trim();

  // Single word that looks like a name (capital letter, no special chars, appears alone)
  const singleName = msg.match(/^([A-Z][a-z]{2,})$/);
  if (singleName) return singleName[1];

  return null;
}

// Only scan USER messages from history
function userHistoryText(history: { role: string; content: string }[]): string {
  return history.filter(m => m.role === 'user').map(m => m.content).join(' ');
}

async function handleCalendarIntent(
  message: string,
  conversationHistory: { role: string; content: string }[],
): Promise<string | null> {

  const isBooking     = isBookingRequest(message);
  const isAvailability = isAvailabilityQuestion(message);

  if (!isBooking && !isAvailability) return null;

  if (isBooking) {
    // Extract from current message first, then user history only
    const userHistory = userHistoryText(conversationHistory);
    const allUserText = userHistory + ' ' + message;

    const date  = extractDate(message)  || extractDate(userHistory);
    const time  = extractTime(message)  || extractTime(userHistory);
    const email = extractEmail(message) || extractEmail(userHistory);
    const name  = extractName(message)  || extractName(userHistory);

    // Have everything — book it
    if (date && time && name) {
      try {
        const startISO = parseTimeToISO(date, time);
        const endISO   = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();

        const event = await bookAppointment(
          `Call with ${name}`,
          `Booked via Mukul's AI Assistant\nName: ${name}${email ? `\nEmail: ${email}` : ''}`,
          startISO,
          endISO,
          undefined, // no attendees — avoids Domain-Wide Delegation error
        );

        return `✅ **Call booked!**\n\n- **Date:** ${date}\n- **Time:** ${time} IST\n- **Name:** ${name}\n${email ? `- **Email:** ${email}\n` : ''}\n[View in Calendar](${event.htmlLink})\n\nMukul will connect with you then!`;
      } catch (err: any) {
        return `Booking failed: ${err.message}. Please try again.`;
      }
    }

    // Ask for what's missing
    if (!date) return `Sure! What date works for you?`;
    if (!time) {
      const slots = await getAvailableSlots(date).catch(() => []);
      return slots.length
        ? `Here are free slots on **${date}**:\n\n${slots.slice(0, 8).map(s => `- ${s}`).join('\n')}\n\nWhich time works?`
        : `What time on ${date} works for you?`;
    }
    if (!name) return `What's your name?`;
  }

  if (isAvailability) {
    const date = extractDate(message) || new Date().toISOString().split('T')[0];
    try {
      const slots = await getAvailableSlots(date);
      if (!slots.length) return `Mukul is fully booked on **${date}**. Try another date?`;
      return `Here are Mukul's open slots on **${date}** (IST):\n\n${slots.slice(0, 8).map(s => `- ${s}`).join('\n')}\n\nWant to book one? Share your name, preferred time, and email.`;
    } catch {
      return `Couldn't fetch availability right now. Email muku0784@gmail.com directly.`;
    }
  }

  return null;
}

// Parse "3:00 PM" + "2026-06-07" → UTC ISO
function parseTimeToISO(date: string, time: string): string {
  const isPM  = /PM/i.test(time);
  const isAM  = /AM/i.test(time);
  const clean = time.replace(/\s?(IST|AM|PM)/gi, '').trim();
  let [h, m]  = clean.split(':').map(n => parseInt(n) || 0);
  if (isPM && h !== 12) h += 12;
  if (isAM && h === 12) h = 0;

  // IST = UTC+5:30
  let utcH = h - 5;
  let utcM = m - 30;
  if (utcM < 0) { utcM += 60; utcH -= 1; }

  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCHours(utcH, utcM, 0, 0);
  return dt.toISOString();
}
const COMMIT_KEYWORDS = [
  'commit', 'last commit', 'recent commit', 'latest commit',
  'commit history', 'last update', 'recently updated', 'last pushed',
];

const KNOWN_PROJECTS = [
  'agento', 'ai-hire', 'edunitex', 'orbital creeper shield', 'sanskritam',
  'knox neural shield', 'agenticiq', 'synapsee', 'circularchain', 'fluxmeter',
  'switch', 'querygenius', 'ulkadrishti', 'astro-cadet', 'gigflow',
  'ai gossip hub', 'rfp-optimize', 'chakra',
];

function isCommitQuestion(msg: string): boolean {
  const lower = msg.toLowerCase();
  return COMMIT_KEYWORDS.some(k => lower.includes(k));
}

function extractProjectName(msg: string): string | null {
  const lower = msg.toLowerCase();
  return KNOWN_PROJECTS.find(p => lower.includes(p)) || null;
}

async function fetchCommitInfo(projectName: string): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/github-repo-commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: projectName }),
    });
    const data = await res.json();
    return data.result || data.message || null;
  } catch {
    return null;
  }
}

// ── Vector search ─────────────────────────────────────────
async function vectorSearch(
  query: string,
  limit = 8,
): Promise<{ content: string; metadata: any; score: number }[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const collection = await getChunksCollection();
    const count = await collection.countDocuments();
    if (count === 0) return [];

    const documents = await collection.find({}).toArray();
    const results = documents.map(doc => ({
      content:  doc.content as string,
      metadata: doc.metadata,
      score:    cosineSimilarity(queryEmbedding, (doc.embedding as number[]) ?? []),
    }));
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  } catch (error) {
    console.error('Error in vector search:', error);
    return [];
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── System prompt ─────────────────────────────────────────
const JOB_DESCRIPTION = `Scaler 3.0 is India's first fully AI-native EdTech platform.
They need: autonomous onboarding agents, conversational agents (text + voice), stateful agentic pipelines (LangGraph/LangChain/CrewAI), production-grade API serving, RAG pipelines, eval frameworks, adversarial red-teaming.
Stack: production Python (async, typed), LLM APIs, Voice AI (Vapi/ElevenLabs), RAG.
Stipend: up to 55k, 6-month internship, PPO opportunity.`;

function buildSystemPrompt(): string {
  return `You are Mukul's AI assistant — sharp, concise, and conversational.

Speak warmly and professionally. Use "Mukul has..." or "He built..." for factual answers. Use "I built..." when answering as Mukul in interview mode.

Respond based on intent:
- Greeting / small talk / reactions → 1-2 warm sentences only.
- "start interview" / "interview mukul" → say "Sure! Go ahead — I'll answer as Mukul." Nothing else.
- Interview questions about Mukul → answer AS Mukul, first person, 3-5 sentences, specific facts only.
- Questions about skills / projects / experience / education / fit → answer using ONLY facts from the context. If missing, say "I don't have that detail — reach Mukul at muku0784@gmail.com".
- Availability / booking a call → say you can check Mukul's calendar and book directly in chat. Ask for their preferred date.

Rules:
- No mode labels, no internal structure labels in output
- No tables
- Bullets max 8 words each
- Max 150 words per response
- Bold key terms, backtick tech names
- No <br> tags
- Only mention projects from context — never invent

Scaler role: ${JOB_DESCRIPTION}`;
}

// ── POST handler ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationHistory = [] } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // ── Calendar intent: availability / booking ───────────
    const calendarResponse = await handleCalendarIntent(message, conversationHistory.slice(-6)).catch(() => null);
    if (calendarResponse) {
      return NextResponse.json({ success: true, response: calendarResponse });
    }

    // ── Commit question: call GitHub API directly ─────────
    if (isCommitQuestion(message)) {
      const projectName = extractProjectName(message);
      if (projectName) {
        const commitInfo = await fetchCommitInfo(projectName);
        if (commitInfo) {
          return NextResponse.json({ success: true, response: commitInfo });
        }
      }
      // No project found — fall through to normal RAG flow
    }

    // ── RAG context ───────────────────────────────────────
    const relevantDocs = await vectorSearch(message, 8);

    // Always include all resume sections
    const collection = await getChunksCollection();
    const resumeDocs = await collection
      .find({ 'metadata.type': { $regex: '^resume' } }, { projection: { embedding: 0 } })
      .toArray();

    const resumeContext = resumeDocs
      .map(d => `[${d.metadata?.section || d.metadata?.type}]\n${d.content}`)
      .join('\n\n');

    const resumeDocIds = new Set(resumeDocs.map(d => String(d._id)));
    const projectContext = relevantDocs
      .filter(d => !resumeDocIds.has(String(d.metadata?._id)) && !String(d.metadata?.type).startsWith('resume'))
      .map(d => d.content)
      .join('\n\n')
      .slice(0, 2000);

    let contextText = '';
    if (resumeContext)  contextText += `=== RESUME ===\n${resumeContext}\n\n`;
    if (projectContext) contextText += `=== PROJECTS ===\n${projectContext}`;
    if (!contextText.trim()) contextText = 'No relevant context found.';

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...conversationHistory.slice(-4),
      { role: 'user',   content: `Context:\n${contextText}\n\n---\nQuestion: ${message}` },
    ];

    const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
    console.log(`[Chat] ~${Math.ceil(totalChars / 4)} tokens, ${totalChars} chars`);

    const responseText = await generateResponse(messages);
    return NextResponse.json({ success: true, response: responseText });

  } catch (error) {
    console.error('Error in chat:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
