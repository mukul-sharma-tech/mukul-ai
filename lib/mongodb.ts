import { MongoClient } from 'mongodb';
import dns from 'dns';

// Force Node.js to use Google/Cloudflare DNS for Atlas SRV resolution
dns.setServers(['8.8.8.8', '1.1.1.1']);

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/mukul-ai';

const client = new MongoClient(uri);

let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  let globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable.
  clientPromise = client.connect();
}

export default clientPromise;

// Vector search helper functions
export async function getDocumentsCollection() {
  const client = await clientPromise;
  return client.db().collection('documents');
}

export async function getChunksCollection() {
  const client = await clientPromise;
  return client.db().collection('chunks');
}
