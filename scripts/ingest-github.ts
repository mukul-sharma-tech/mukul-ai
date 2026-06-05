/**
 * Fetches README + repo metadata from GitHub for each project
 * and ingests it into the vector database.
 *
 * Usage:
 *   npm run ingest:github
 *
 * Optional: set GITHUB_TOKEN env var to avoid rate limiting
 *   $env:GITHUB_TOKEN="ghp_xxxx"; npm run ingest:github
 */

import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api/documents';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

interface ProjectLink {
  name: string;
  github: string;
  live: string | null;
}

// Parse "https://github.com/owner/repo" → { owner, repo }
function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function githubFetch(url: string): Promise<any> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'mukul-ai-ingestion',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
  return res.json();
}

async function fetchRepoData(owner: string, repo: string) {
  // Fetch repo metadata and README in parallel
  const [repoMeta, readmeData] = await Promise.all([
    githubFetch(`https://api.github.com/repos/${owner}/${repo}`),
    githubFetch(`https://api.github.com/repos/${owner}/${repo}/readme`).catch(() => null),
  ]);

  // README is base64 encoded
  const readmeText = readmeData?.content
    ? Buffer.from(readmeData.content, 'base64').toString('utf-8')
    : '';

  return { repoMeta, readmeText };
}

function buildRepoDocument(
  project: ProjectLink,
  repoMeta: any,
  readmeText: string
): string {
  const lines: string[] = [];

  lines.push(`# ${project.name}`);
  lines.push('');

  // Basic info
  lines.push(`**GitHub:** ${project.github}`);
  if (project.live) lines.push(`**Live:** ${project.live}`);
  lines.push('');

  // Repo metadata from GitHub API
  if (repoMeta.description) {
    lines.push(`**Description:** ${repoMeta.description}`);
  }
  if (repoMeta.language) {
    lines.push(`**Primary Language:** ${repoMeta.language}`);
  }
  if (repoMeta.topics?.length) {
    lines.push(`**Topics:** ${repoMeta.topics.join(', ')}`);
  }
  lines.push(`**Stars:** ${repoMeta.stargazers_count} | **Forks:** ${repoMeta.forks_count}`);
  lines.push('');

  // README content (main knowledge source)
  if (readmeText) {
    lines.push('## README');
    lines.push(readmeText.trim());
  } else {
    lines.push('## README');
    lines.push('No README available.');
  }

  return lines.join('\n');
}

async function ingestDocument(content: string, name: string, githubUrl: string) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      metadata: {
        type: 'github',
        source: `github-${name.toLowerCase().replace(/\s+/g, '-')}`,
        projectName: name,
        githubUrl,
      },
    }),
  });
  return res.json();
}

async function main() {
  const linksPath = path.join(process.cwd(), 'data', 'project_link');
  const projects: ProjectLink[] = JSON.parse(fs.readFileSync(linksPath, 'utf-8'));

  console.log(`\n🚀 Ingesting ${projects.length} GitHub repos...\n`);
  if (!GITHUB_TOKEN) {
    console.log('⚠️  No GITHUB_TOKEN set — rate limit: 60 req/hr. Set $env:GITHUB_TOKEN to increase.\n');
  }

  let success = 0;
  let failed = 0;

  for (const project of projects) {
    process.stdout.write(`  📦 ${project.name}... `);

    const parsed = parseGithubUrl(project.github);
    if (!parsed) {
      console.log('❌ Invalid URL');
      failed++;
      continue;
    }

    try {
      const { repoMeta, readmeText } = await fetchRepoData(parsed.owner, parsed.repo);
      const doc = buildRepoDocument(project, repoMeta, readmeText);
      const result = await ingestDocument(doc, project.name, project.github);

      if (result.success) {
        console.log(`✅ ${result.insertedCount} chunks`);
        success++;
      } else {
        console.log(`❌ ${result.error}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ ${err instanceof Error ? err.message : err}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📊 Done: ${success} succeeded, ${failed} failed`);

  // Show DB stats
  try {
    const stats = await fetch(`${API_BASE}/ingest`).then(r => r.json());
    console.log(`📁 Total chunks in DB: ${stats.totalDocuments}`);
    console.log('   By type:', stats.byType);
  } catch {
    // ignore
  }
}

main().catch(console.error);
