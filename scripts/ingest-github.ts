/**
 * Direct MongoDB GitHub README ingestion — no dev server needed.
 * Run: npm run ingest:github
 *
 * Fetches README + metadata from GitHub API for each repo in data/project_link
 * → chunks → embeds via Ollama → stores directly in MongoDB Atlas
 *
 * Optional: $env:GITHUB_TOKEN="ghp_xxx"; npm run ingest:github
 */

import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { MongoClient } from 'mongodb';
import ollama from 'ollama';

dns.setServers(['8.8.8.8', '1.1.1.1']);

// ── Load .env.local ───────────────────────────────────────
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

const MONGO_URI     = process.env.MONGO_URI || 'mongodb://localhost:27017/mukul-ai';
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN || '';
const EMBED_MODEL   = 'nomic-embed-text';

// ── Types ─────────────────────────────────────────────────
interface ProjectLink {
  name:   string;
  github: string;
  live:   string | null;
}

// ── Helpers ───────────────────────────────────────────────
function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function ghFetch(url: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mukul-ai-ingestion',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`);
  return res.json();
}

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

function buildDoc(project: ProjectLink, repoMeta: any, readmeText: string): string {
  const lines: string[] = [
    `# ${project.name}`,
    `GitHub: ${project.github}`,
    project.live ? `Live: ${project.live}` : '',
    repoMeta.description ? `Description: ${repoMeta.description}` : '',
    repoMeta.language    ? `Primary Language: ${repoMeta.language}` : '',
    repoMeta.topics?.length ? `Topics: ${repoMeta.topics.join(', ')}` : '',
    `Stars: ${repoMeta.stargazers_count} | Forks: ${repoMeta.forks_count}`,
    '',
    '## README',
    readmeText.trim() || 'No README available.',
  ];
  return lines.filter(l => l !== null).join('\n');
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Direct GitHub → MongoDB ingestion\n');

  if (!GITHUB_TOKEN) {
    console.log('⚠️  No GITHUB_TOKEN — rate limit: 60 req/hr\n   Set $env:GITHUB_TOKEN="ghp_xxx" to increase\n');
  }

  // Connect MongoDB
  console.log(`📡 Connecting to MongoDB...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ MongoDB connected\n');

  const collection = client.db().collection('chunks');

  // Load project list
  const linksPath = path.join(process.cwd(), 'data', 'project_link');
  const projects: ProjectLink[] = JSON.parse(fs.readFileSync(linksPath, 'utf-8'));
  console.log(`� Found ${projects.length} repos in project_link\n`);

  let success = 0;
  let failed  = 0;

  for (const project of projects) {
    process.stdout.write(`  📦 ${project.name}... `);

    const parsed = parseGithubUrl(project.github);
    if (!parsed) {
      console.log('❌ Invalid URL');
      failed++;
      continue;
    }

    try {
      // Fetch GitHub data
      const [repoMeta, readmeData] = await Promise.all([
        ghFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`),
        ghFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`).catch(() => null),
      ]);

      const readmeText = readmeData?.content
        ? Buffer.from(readmeData.content, 'base64').toString('utf-8')
        : '';

      const docText = buildDoc(project, repoMeta, readmeText);
      const chunks  = chunkText(docText);

      console.log(`${chunks.length} chunks...`);

      // Embed and insert
      const docs = [];
      for (let i = 0; i < chunks.length; i++) {
        process.stdout.write(`     embedding ${i + 1}/${chunks.length}\r`);
        const embedding = await embed(chunks[i]);
        docs.push({
          content:   chunks[i],
          embedding,
          metadata: {
            type:        'github',
            source:      `github-${project.name.toLowerCase().replace(/\s+/g, '-')}`,
            projectName: project.name,
            githubUrl:   project.github,
            liveUrl:     project.live,
            chunkIndex:  i,
            totalChunks: chunks.length,
            createdAt:   new Date(),
          },
        });
      }

      await collection.insertMany(docs);
      console.log(`     ✅ inserted ${docs.length} chunks               `);
      success++;
    } catch (err) {
      console.log(`❌ ${err instanceof Error ? err.message : err}`);
      failed++;
    }

    // Respect GitHub rate limit
    await new Promise(r => setTimeout(r, 600));
  }

  // Final stats
  const total  = await collection.countDocuments();
  const byType = await collection.aggregate([
    { $group: { _id: '$metadata.type', count: { $sum: 1 } } },
  ]).toArray();

  console.log(`\n📊 Done: ${success} repos succeeded, ${failed} failed`);
  console.log(`   Total chunks in DB: ${total}`);
  byType.forEach(t => console.log(`   ${t._id}: ${t.count}`));

  await client.close();
  console.log('\n✨ GitHub ingestion complete!');
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
