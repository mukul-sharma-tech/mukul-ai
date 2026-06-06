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
const AVAILABILITY_KEYWORDS = ['available', 'availability', 'free slot', 'free time', 'schedule', 'when can', 'book a call', 'book call', 'check calendar'];
const BOOKING_KEYWORDS = ['book', 'schedule a call', 'set up a call', 'confirm', 'reserve'];

function isAvailabilityQuestion(msg: string): boolean {
  const lower = msg.toLowerCase();
  return AVAILABILITY_KEYWORDS.some(k => lower.includes(k));
}

function isBookingRequest(msg: string): boolean {
  const lower = msg.toLowerCase();
  return BOOKING_KEYWORDS.some(k => lower.includes(k));
}

// Extract date from message — supports "today", "tomorrow", "June 10", "2026-06-10"
function extractDate(msg: string): string | null {
  const lower = msg.toLowerCase();
  const now   = new Date();

  if (lower.includes('today')) {
    return now.toISOString().split('T')[0];
  }
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  // Match YYYY-MM-DD
  const isoMatch = msg.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Match "June 10" or "10 June"
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const monthMatch = lower.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/);
  const dayFirst   = lower.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)/);

  const matched = monthMatch || dayFirst;
  if (matched) {
    const monthStr = monthMatch ? matched[1] : matched[2];
    const dayStr   = monthMatch ? matched[2] : matched[1];
    const month    = months[monthStr];
    const day      = parseInt(dayStr);
    const year     = now.getFullYear();
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

// Extract time from message: "10:30 AM", "2 PM", "14:00"
function extractTime(msg: string): string | null {
  const timeMatch = msg.match(/\b(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?\b/);
  if (!timeMatch) return null;
  const hours   = timeMatch[1];
  const minutes = timeMatch[2] || '00';
  const ampm    = timeMatch[3] || '';
  return `${hours}:${minutes} ${ampm}`.trim();
}

// Extract name and email from booking message
function extractContactInfo(msg: string): { name: string | null; email: string | null } {
  const emailMatch = msg.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;

  // Simple name extraction — "my name is X" or "I'm X"
  const nameMatch = msg.match(/(?:my name is|i'm|i am|name:)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  const name = nameMatch ? nameMatch[1] : null;

  return { name, email };
}

async function handleCalendarIntent(
  message: string,
  conversationHistory: { role: string; content: string }[],
): Promise<string | null> {

  // Check if booking with time details
  if (isBookingRequest(message)) {
    const date = extractDate(message);
    const time = extractTime(message);
    const { name, email } = extractContactInfo(message);

    // Also check conversation history for date/time/name if not in current message
    const history = conversationHistory.map(m => m.content).join(' ');
    const finalDate  = date  || extractDate(history);
    const finalTime  = time  || extractTime(history);
    const finalName  = name  || extractContactInfo(history).name;
    const finalEmail = email || extractContactInfo(history).email;

    if (finalDate && finalTime && finalName) {
      try {
        const startISO = parseTimeToISO(finalDate, finalTime);
        const endISO   = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();

        const event = await bookAppointment(
          `Call with ${finalName}`,
          `Booked via Mukul's AI Assistant\nFrom: ${finalName}${finalEmail ? ` (${finalEmail})` : ''}`,
          startISO,
          endISO,
          finalEmail || undefined,
        );

        return `✅ **Call booked!**\n\n- **Date:** ${finalDate}\n- **Time:** ${finalTime} IST\n- **With:** ${finalName}\n${finalEmail ? `- **Email:** ${finalEmail}\n` : ''}\n[View in Calendar](${event.htmlLink})\n\nMukul will connect with you then!`;
      } catch (err: any) {
        if (err.message?.includes('409') || err.message?.includes('busy')) {
          return `That slot was just taken. Let me check again — what other time works for you?`;
        }
        return `Booking failed: ${err.message}. Please try again.`;
      }
    }

    // Missing info — ask for it
    if (!finalDate) return `Sure, I can book a call! What date works for you?`;
    if (!finalTime) {
      const slots = await getAvailableSlots(finalDate).catch(() => []);
      if (slots.length) {
        return `Great! Here are available slots on **${finalDate}**:\n\n${slots.slice(0, 8).map(s => `- ${s}`).join('\n')}\n\nWhich time works for you?`;
      }
      return `What time on ${finalDate} works for you?`;
    }
    if (!finalName) return `Almost there! What's your name?`;
  }

  // Availability check
  if (isAvailabilityQuestion(message)) {
    const date = extractDate(message) || new Date().toISOString().split('T')[0];
    try {
      const slots = await getAvailableSlots(date);
      if (!slots.length) {
        return `Mukul is fully booked on **${date}**. Try another date?`;
      }
      return `Here are Mukul's open slots on **${date}** (IST):\n\n${slots.slice(0, 8).map(s => `- ${s}`).join('\n')}\n\nWant to book one? Tell me your name, preferred time, and email.`;
    } catch (err) {
      return `Couldn't fetch availability right now. Try emailing muku0784@gmail.com directly.`;
    }
  }

  return null;
}

// Parse time string + date to UTC ISO
function parseTimeToISO(date: string, time: string): string {
  const isPM = /PM/i.test(time);
  const isAM = /AM/i.test(time);
  const clean = time.replace(/\s?(IST|AM|PM)/gi, '').trim();
  let [hours, minutes] = clean.split(':').map(n => parseInt(n) || 0);
  if (isPM && hours !== 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  // IST = UTC+5:30 → subtract 5h30m
  let utcH = hours - 5;
  let utcM = minutes - 30;
  if (utcM < 0) { utcM += 60; utcH -= 1; }

  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCHours(utcH, utcM, 0, 0);
  return dt.toISOString();
}
// ──────────────────────────────────────────────────────────
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
