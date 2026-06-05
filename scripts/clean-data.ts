import path from 'path';
import fs from 'fs';
import dns from 'dns';
import { MongoClient } from 'mongodb';

dns.setServers(['8.8.8.8', '1.1.1.1']);

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

async function main() {
  console.log('\n🗑️  Cleaning all vectors from MongoDB...\n');
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  const result = await client.db().collection('chunks').deleteMany({});
  console.log(`✅ Deleted ${result.deletedCount} documents`);

  await client.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
