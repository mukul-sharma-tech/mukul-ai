/**
 * Smart section-aware ingestion — no dev server needed.
 * Run: npm run ingest
 *
 * Resume   → split by section (Summary, Education, Experience, Skills, Projects, Achievements)
 * Projects → split per project block
 * Links    → one doc per project link entry
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
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
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

const MONGO_URI   = process.env.MONGO_URI || 'mongodb://localhost:27017/mukul-ai';
const EMBED_MODEL = 'nomic-embed-text';

// ── Embed ─────────────────────────────────────────────────
async function embed(text: string): Promise<number[]> {
  const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: text });
  return res.embedding;
}

// ── Resume section parser ─────────────────────────────────
interface Section {
  title:   string;
  content: string;
  type:    string;
}

function parseResumeSections(text: string): Section[] {
  const SECTION_HEADERS = [
    'Summary',
    'Education',
    'Experience',
    'Technical Skills',
    'Projects',
    'Achievements',
  ];

  const lines = text.split('\n');
  const sections: Section[] = [];
  let currentTitle = 'Header';
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const matched = SECTION_HEADERS.find(h =>
      trimmed === h || trimmed.startsWith(h + ':') || trimmed.startsWith('• ' + h)
    );

    if (matched) {
      if (currentLines.join('').trim()) {
        sections.push({
          title:   currentTitle,
          content: currentLines.join('\n').trim(),
          type:    sectionType(currentTitle),
        });
      }
      currentTitle = matched;
      currentLines = [trimmed];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.join('').trim()) {
    sections.push({
      title:   currentTitle,
      content: currentLines.join('\n').trim(),
      type:    sectionType(currentTitle),
    });
  }

  return sections.filter(s => s.content.length > 30);
}

function sectionType(title: string): string {
  const map: Record<string, string> = {
    'Header':            'resume-contact',
    'Summary':           'resume-summary',
    'Education':         'resume-education',
    'Experience':        'resume-experience',
    'Technical Skills':  'resume-skills',
    'Projects':          'resume-projects',
    'Achievements':      'resume-achievements',
  };
  return map[title] || 'resume';
}

// ── Project block parser ──────────────────────────────────
function parseProjectBlocks(text: string): { name: string; content: string }[] {
  const blocks: { name: string; content: string }[] = [];
  // Each project starts with a line ending in a tech stack pattern
  // e.g. "Agento: Secure Access | Enterprise AI System | Next.js, TypeScript..."
  const lines = text.split('\n');
  let currentName = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect project header: non-bullet line with pipe separators or starts a new block
    const isProjectHeader =
      trimmed.length > 0 &&
      !trimmed.startsWith('◦') &&
      !trimmed.startsWith('•') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('GitHub:') &&
      !trimmed.startsWith('Live:') &&
      trimmed.includes('|') &&
      !trimmed.startsWith('|');

    if (isProjectHeader) {
      if (currentName && currentLines.join('').trim()) {
        blocks.push({ name: currentName, content: currentLines.join('\n').trim() });
      }
      currentName  = trimmed.split('|')[0].trim().split(':')[0].trim();
      currentLines = [trimmed];
    } else {
      currentLines.push(line);
    }
  }

  if (currentName && currentLines.join('').trim()) {
    blocks.push({ name: currentName, content: currentLines.join('\n').trim() });
  }

  return blocks.filter(b => b.content.length > 40);
}

// ── Insert a chunk ────────────────────────────────────────
async function insertChunk(
  collection: any,
  content: string,
  type: string,
  source: string,
  extra: Record<string, any> = {},
) {
  const embedding = await embed(content);
  await collection.insertOne({
    content,
    embedding,
    metadata: { type, source, createdAt: new Date(), ...extra },
  });
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Section-aware MongoDB ingestion\n');

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ MongoDB connected\n');

  const collection = client.db().collection('chunks');

  // Clear existing
  const deleted = await collection.deleteMany({});
  console.log(`🗑️  Cleared ${deleted.deletedCount} existing chunks\n`);

  const dataDir = path.join(process.cwd(), 'data');

  // ── 1. Resume sections ────────────────────────────────
  console.log('📄 Parsing resume sections...');
  const resumeText = fs.readFileSync(path.join(dataDir, 'resume.txt'), 'utf-8');
  const sections   = parseResumeSections(resumeText);

  for (const sec of sections) {
    process.stdout.write(`   [${sec.title}] embedding...\r`);
    await insertChunk(collection, sec.content, sec.type, `resume-${sec.title.toLowerCase().replace(/\s/g, '-')}`, {
      section: sec.title,
    });
    console.log(`   ✅ [${sec.title}] stored (${sec.content.length} chars)`);
  }

  // ── 2. Project blocks ─────────────────────────────────
  console.log('\n📁 Parsing project blocks...');
  const projectsText = fs.readFileSync(path.join(dataDir, 'projects.txt'), 'utf-8');
  const projectBlocks = parseProjectBlocks(projectsText);

  for (const block of projectBlocks) {
    process.stdout.write(`   [${block.name}] embedding...\r`);
    await insertChunk(collection, block.content, 'github', `project-${block.name.toLowerCase().replace(/\s/g, '-')}`, {
      projectName: block.name,
    });
    console.log(`   ✅ [${block.name}] stored (${block.content.length} chars)`);
  }

  // ── 3. Project links (one per entry) ─────────────────
  console.log('\n🔗 Parsing project links...');
  const linksRaw = fs.readFileSync(path.join(dataDir, 'project_link'), 'utf-8');
  const links: { name: string; github: string; live: string | null }[] = JSON.parse(linksRaw);

  for (const link of links) {
    const content = `${link.name}\nGitHub: ${link.github}${link.live ? `\nLive: ${link.live}` : ''}`;
    await insertChunk(collection, content, 'project-link', `link-${link.name.toLowerCase().replace(/\s/g, '-')}`, {
      projectName: link.name,
      githubUrl:   link.github,
      liveUrl:     link.live,
    });
    console.log(`   ✅ [${link.name}] link stored`);
  }

  // ── Stats ─────────────────────────────────────────────
  const total  = await collection.countDocuments();
  const byType = await collection.aggregate([
    { $group: { _id: '$metadata.type', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();

  console.log('\n📊 Final stats:');
  console.log(`   Total chunks: ${total}`);
  byType.forEach(t => console.log(`   ${t._id}: ${t.count}`));

  await client.close();
  console.log('\n✨ Ingestion complete! Run npm run ingest:github to also add GitHub READMEs.');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
