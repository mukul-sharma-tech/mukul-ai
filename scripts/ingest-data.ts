import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000/api/documents';

interface IngestResponse {
  success: boolean;
  message: string;
  chunksCreated?: number;
}

async function ingestDocument(content: string, type: string, source: string): Promise<IngestResponse> {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      metadata: { type, source },
    }),
  });
  return response.json();
}

async function main() {
  console.log('🚀 Starting data ingestion...\n');

  const dataDir = path.join(process.cwd(), 'data');

  // 1. Ingest Resume
  console.log('📄 Ingesting resume.txt...');
  const resumeContent = fs.readFileSync(path.join(dataDir, 'resume.txt'), 'utf-8');
  const resumeResult = await ingestDocument(resumeContent, 'resume', 'resume-full');
  console.log(`   ✅ ${resumeResult.message}\n`);

  // 2. Ingest Projects
  console.log('📁 Ingesting projects.txt...');
  const projectsContent = fs.readFileSync(path.join(dataDir, 'projects.txt'), 'utf-8');
  const projectsResult = await ingestDocument(projectsContent, 'github', 'projects-full');
  console.log(`   ✅ ${projectsResult.message}\n`);

  // 3. Ingest Project Links as metadata
  console.log('🔗 Ingesting project_link...');
  const projectLinksContent = fs.readFileSync(path.join(dataDir, 'project_link'), 'utf-8');
  const linksResult = await ingestDocument(projectLinksContent, 'github', 'project-links');
  console.log(`   ✅ ${linksResult.message}\n`);

  // Get final stats
  const statsResponse = await fetch(`${API_BASE}/ingest`);
  const stats = await statsResponse.json();
  
  console.log('📊 Final Statistics:');
  console.log(`   Total Documents: ${stats.totalDocuments}`);
  console.log(`   By Type:`, stats.byType);
  console.log('\n✨ Ingestion complete!');
}

main().catch(console.error);
