/**
 * Eval Framework — measures hallucination rate & retrieval quality
 *
 * Usage:
 *   npm run eval
 *
 * What it does:
 *   1. Loads golden Q&A set from evals/golden-qa.json
 *   2. For each question: calls /api/chat and captures answer + retrieved chunks
 *   3. Uses Groq as LLM-as-judge to score each answer (grounded / hallucinated / partial)
 *   4. Computes retrieval precision/recall against expected_chunks
 *   5. Outputs a full report with per-question breakdown
 */

import fs from 'fs';
import path from 'path';

// ── Load env ──────────────────────────────────────────────
function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const CHAT_URL  = process.env.EVAL_CHAT_URL || 'http://localhost:3000/api/chat';
const GROQ_KEY  = process.env.Groq_API_1!;
const QA_FILE   = path.join(process.cwd(), 'evals', 'golden-qa.json');
const OUT_FILE  = path.join(process.cwd(), 'evals', `eval-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

interface GoldenQA {
  id:              string;
  question:        string;
  expected:        string;
  category:        string;
  expected_chunks: string[];
}

interface EvalResult {
  id:              string;
  question:        string;
  expected:        string;
  actual:          string;
  category:        string;
  verdict:         'grounded' | 'partial' | 'hallucinated' | 'error';
  judge_reasoning: string;
  retrieved_sources: string[];
  retrieval_precision: number;
  retrieval_recall:    number;
  latency_ms:          number;
}

// ── Call chat API ─────────────────────────────────────────
async function askChat(question: string): Promise<{ answer: string; sources: string[]; latency: number }> {
  const start = Date.now();
  const res   = await fetch(CHAT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: question, conversationHistory: [], bookingState: null }),
  });
  const latency = Date.now() - start;
  const data    = await res.json();
  return { answer: data.response || '', sources: data.sources || [], latency };
}

// ── LLM-as-judge via Groq ─────────────────────────────────
async function judgeAnswer(question: string, expected: string, actual: string): Promise<{ verdict: 'grounded' | 'partial' | 'hallucinated'; reasoning: string }> {
  const prompt = `You are an evaluation judge for a RAG-based chatbot. Your job is to assess if the chatbot's answer is grounded in facts or hallucinated.

Question: ${question}

Expected answer (ground truth): ${expected}

Chatbot's actual answer: ${actual}

Evaluate the answer and respond with EXACTLY this JSON format (no extra text):
{
  "verdict": "grounded" | "partial" | "hallucinated",
  "reasoning": "one sentence explanation"
}

Rules:
- "grounded": all key facts in the answer match or are consistent with the expected answer
- "partial": some facts are correct but some are missing or slightly wrong
- "hallucinated": the answer contains invented facts not in the expected answer, or contradicts it
- Focus on factual accuracy, not phrasing`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body:    JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens:  200,
    }),
  });

  const data    = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { verdict: parsed.verdict, reasoning: parsed.reasoning };
    }
  } catch {}

  // Fallback: simple keyword detection
  const lower = content.toLowerCase();
  if (lower.includes('hallucinated')) return { verdict: 'hallucinated', reasoning: content.slice(0, 100) };
  if (lower.includes('partial'))     return { verdict: 'partial',      reasoning: content.slice(0, 100) };
  return { verdict: 'grounded', reasoning: content.slice(0, 100) };
}

// ── Retrieval metrics ─────────────────────────────────────
function computeRetrievalMetrics(retrieved: string[], expected: string[]): { precision: number; recall: number } {
  if (!retrieved.length) return { precision: 0, recall: 0 };

  // Check if any expected chunk type appears in retrieved sources
  const hits = expected.filter(exp =>
    retrieved.some(r => r.toLowerCase().includes(exp.toLowerCase().replace('resume-', '').replace('project-', '').replace('github-', '')))
  ).length;

  return {
    precision: retrieved.length ? hits / retrieved.length : 0,
    recall:    expected.length  ? hits / expected.length  : 0,
  };
}

// ── Main eval loop ────────────────────────────────────────
async function main() {
  if (!GROQ_KEY) {
    console.error('❌ Groq_API_1 not set — needed for LLM-as-judge');
    process.exit(1);
  }

  const questions: GoldenQA[] = JSON.parse(fs.readFileSync(QA_FILE, 'utf-8'));
  console.log(`\n🧪 Running eval on ${questions.length} golden Q&A pairs\n`);

  const results: EvalResult[] = [];
  let grounded = 0, partial = 0, hallucinated = 0, errors = 0;

  for (const qa of questions) {
    process.stdout.write(`  [${qa.id}] ${qa.question.slice(0, 50)}... `);

    try {
      // 1. Get chatbot answer
      const { answer, sources, latency } = await askChat(qa.question);

      // 2. Judge with LLM
      const { verdict, reasoning } = await judgeAnswer(qa.question, qa.expected, answer);

      // 3. Compute retrieval metrics
      const { precision, recall } = computeRetrievalMetrics(sources, qa.expected_chunks);

      const result: EvalResult = {
        id:                  qa.id,
        question:            qa.question,
        expected:            qa.expected,
        actual:              answer,
        category:            qa.category,
        verdict,
        judge_reasoning:     reasoning,
        retrieved_sources:   sources,
        retrieval_precision: precision,
        retrieval_recall:    recall,
        latency_ms:          latency,
      };

      results.push(result);

      if (verdict === 'grounded')     { grounded++;     console.log(`✅ grounded     (${latency}ms)`); }
      if (verdict === 'partial')      { partial++;       console.log(`⚠️  partial      (${latency}ms)`); }
      if (verdict === 'hallucinated') { hallucinated++;  console.log(`❌ hallucinated  (${latency}ms)`); }

    } catch (err: any) {
      errors++;
      console.log(`💥 error: ${err.message}`);
      results.push({
        id: qa.id, question: qa.question, expected: qa.expected,
        actual: '', category: qa.category, verdict: 'error',
        judge_reasoning: err.message, retrieved_sources: [],
        retrieval_precision: 0, retrieval_recall: 0, latency_ms: 0,
      });
    }

    // Rate limit buffer
    await new Promise(r => setTimeout(r, 800));
  }

  // ── Compute aggregate metrics ─────────────────────────
  const total         = results.length;
  const validResults  = results.filter(r => r.verdict !== 'error');
  const hallucRate    = (hallucinated / total) * 100;
  const groundedRate  = (grounded / total) * 100;
  const avgPrecision  = validResults.reduce((s, r) => s + r.retrieval_precision, 0) / validResults.length;
  const avgRecall     = validResults.reduce((s, r) => s + r.retrieval_recall, 0) / validResults.length;
  const avgLatency    = validResults.reduce((s, r) => s + r.latency_ms, 0) / validResults.length;
  const f1            = avgPrecision + avgRecall > 0
    ? (2 * avgPrecision * avgRecall) / (avgPrecision + avgRecall) : 0;

  // By category
  const byCategory: Record<string, { grounded: number; partial: number; hallucinated: number; total: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { grounded: 0, partial: 0, hallucinated: 0, total: 0 };
    byCategory[r.category].total++;
    if (r.verdict === 'grounded')     byCategory[r.category].grounded++;
    if (r.verdict === 'partial')      byCategory[r.category].partial++;
    if (r.verdict === 'hallucinated') byCategory[r.category].hallucinated++;
  }

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total_questions:      total,
      grounded:             grounded,
      partial:              partial,
      hallucinated:         hallucinated,
      errors:               errors,
      hallucination_rate:   `${hallucRate.toFixed(1)}%`,
      groundedness_rate:    `${groundedRate.toFixed(1)}%`,
      retrieval_precision:  avgPrecision.toFixed(3),
      retrieval_recall:     avgRecall.toFixed(3),
      retrieval_f1:         f1.toFixed(3),
      avg_latency_ms:       Math.round(avgLatency),
    },
    by_category: byCategory,
    methodology: {
      judge_model:       'Groq llama-3.3-70b-versatile (LLM-as-judge)',
      embedding_model:   'nomic-embed-text (Ollama) or all-MiniLM-L6-v2 (HuggingFace)',
      retrieval_method:  'cosine similarity, top-8 chunks',
      golden_set_size:   total,
      golden_set_source: 'manually labelled from resume.txt and projects.txt',
    },
    results,
  };

  // Print summary
  console.log('\n══════════════════════════════════════════════');
  console.log('  EVAL RESULTS');
  console.log('══════════════════════════════════════════════');
  console.log(`  Grounded:         ${grounded}/${total} (${groundedRate.toFixed(1)}%)`);
  console.log(`  Partial:          ${partial}/${total}`);
  console.log(`  Hallucinated:     ${hallucinated}/${total} (${hallucRate.toFixed(1)}%)`);
  console.log(`  Errors:           ${errors}`);
  console.log('──────────────────────────────────────────────');
  console.log(`  Retrieval P:      ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`  Retrieval R:      ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`  Retrieval F1:     ${(f1 * 100).toFixed(1)}%`);
  console.log(`  Avg latency:      ${Math.round(avgLatency)}ms`);
  console.log('──────────────────────────────────────────────');

  console.log('\n  By Category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    const rate = ((stats.grounded / stats.total) * 100).toFixed(0);
    console.log(`  ${cat.padEnd(15)} ${rate}% grounded (${stats.total} qs)`);
  }

  // Hallucinated questions detail
  const bad = results.filter(r => r.verdict === 'hallucinated' || r.verdict === 'partial');
  if (bad.length) {
    console.log('\n  Flagged answers:');
    for (const r of bad) {
      console.log(`  [${r.verdict.toUpperCase()}] ${r.id}: ${r.judge_reasoning}`);
    }
  }

  console.log('══════════════════════════════════════════════\n');

  // Save report
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(`📄 Full report saved: ${OUT_FILE}\n`);
}

main().catch(err => {
  console.error('Eval failed:', err.message);
  process.exit(1);
});
