/**
 * Direct MongoDB ingestion — no dev server needed.
 * Run: npm run ingest
 *
 * Reads data/resume.txt, data/projects.txt, data/project_link
 * → chunks them → embeds via Ollama (nomic-embed-text)
 * → stores directly in MongoDB Atlas (chunks collection)
 */

import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { MongoClient } from 'mongodb';
import ollama from 'ollama';

// Force Google/Cloudflare DNS for Atlas SRV resolution
dns.setServers(['8.8.8.8', '1.1.1.1']);

// ── Config ────────────────────────────────────────────────
// Load .env.local manually (tsx doesn't load it automatically)
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mukul-ai';
const EMBED_MODEL = 'nomic-embed-text';

// ── Helpers ───────────────────────────────────────────────
async function embed(text: string): Promise<number[]> {
  const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: text });
  return res.embedding;
}

function chunkText(text: string, maxLen = 600): string[] {
  const sections = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const sec of sections) {
    const s = sec.trim();
    if (!s) continue;
    if (current.length + s.length + 2 > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += (current ? '\n\n' : '') + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 20);
}

async function ingestFile(
  collection: any,
  content: string,
  type: string,
  source: string,
  fileName: string,
) {
  const chunks = chunkText(content);
  console.log(`   ${chunks.length} chunks...`);

  const docs = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`   embedding ${i + 1}/${chunks.length}\r`);
    const embedding = await embed(chunks[i]);
    docs.push({
      content: chunks[i],
      embedding,
      metadata: { type, source, fileName, chunkIndex: i, totalChunks: chunks.length, createdAt: new Date() },
    });
  }

  const result = await collection.insertMany(docs);
  console.log(`   ✅ inserted ${result.insertedCount} chunks         `);
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Direct MongoDB ingestion\n');
  console.log(`📡 Connecting to: ${MONGO_URI.replace(/:([^@]+)@/, ':****@')}\n`);

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ MongoDB connected\n');

  const db = client.db();
  const collection = db.collection('chunks');

  // Clear existing data
  const deleted = await collection.deleteMany({});
  console.log(`🗑️  Cleared ${deleted.deletedCount} existing chunks\n`);

  const dataDir = path.join(process.cwd(), 'data');

  // 1. Resume
  console.log('📄 Ingesting resume.txt...');
  const resume = fs.readFileSync(path.join(dataDir, 'resume.txt'), 'utf-8');
  await ingestFile(collection, resume, 'resume', 'resume-full', 'resume.txt');

  // 2. Projects
  console.log('\n📁 Ingesting projects.txt...');
  const projects = fs.readFileSync(path.join(dataDir, 'projects.txt'), 'utf-8');
  await ingestFile(collection, projects, 'github', 'projects-full', 'projects.txt');

  // 3. Project links
  console.log('\n🔗 Ingesting project_link...');
  const links = fs.readFileSync(path.join(dataDir, 'project_link'), 'utf-8');
  await ingestFile(collection, links, 'github', 'project-links', 'project_link');

  // Stats
  const total = await collection.countDocuments();
  const byType = await collection.aggregate([
    { $group: { _id: '$metadata.type', count: { $sum: 1 } } },
  ]).toArray();

  console.log('\n📊 Final stats:');
  console.log(`   Total chunks: ${total}`);
  byType.forEach(t => console.log(`   ${t._id}: ${t.count}`));

  await client.close();
  console.log('\n✨ Ingestion complete!');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
