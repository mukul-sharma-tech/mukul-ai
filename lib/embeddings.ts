import ollama from 'ollama';
import { HfInference } from '@huggingface/inference';

const OLLAMA_MODEL = 'nomic-embed-text';
const HF_MODEL     = process.env.HF_EMBEDDING_MODEL || 'sentence-transformers/all-MiniLM-L6-v2';

// ── Embedding with Ollama → HuggingFace fallback ──────────
export async function generateEmbedding(text: string): Promise<number[]> {
  // 1. Try Ollama (local — works in dev)
  try {
    const res = await ollama.embeddings({ model: OLLAMA_MODEL, prompt: text });
    if (res.embedding?.length) return res.embedding;
    throw new Error('Empty embedding from Ollama');
  } catch (err) {
    console.warn('[Embed] Ollama failed, trying HuggingFace:', (err as Error).message);
  }

  // 2. Fallback: HuggingFace Inference API (works on cloud/Vercel)
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    throw new Error('[Embed] HF_TOKEN not set and Ollama unavailable — embedding failed');
  }

  try {
    const hf     = new HfInference(hfToken);
    const result = await hf.featureExtraction({ model: HF_MODEL, inputs: text });
    const embedding = Array.isArray(result[0])
      ? (result as number[][])[0]
      : (result as number[]);
    console.log(`[Embed] HuggingFace OK (${embedding.length} dims)`);
    return embedding;
  } catch (err) {
    throw new Error(`[Embed] HuggingFace also failed: ${(err as Error).message}`);
  }
}

export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    embeddings.push(await generateEmbedding(text));
  }
  return embeddings;
}

// Smart chunking that preserves semantic sections
export function chunkText(text: string, maxChunkSize = 500, _overlap = 50): string[] {
  const sections = text.split(/\n\s*\n/);
  const chunks: string[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.length <= maxChunkSize) {
      chunks.push(trimmed);
    } else {
      const sentences = trimmed.split(/(?<=[.!?])\s+/);
      let current = '';
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > maxChunkSize && current.length > 0) {
          chunks.push(current.trim());
          const words = current.split(' ');
          current = words.slice(-5).join(' ') + ' ' + sentence;
        } else {
          current += (current ? ' ' : '') + sentence;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }

  return chunks.filter(c => c.length > 20);
}
