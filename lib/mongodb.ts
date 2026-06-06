import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/mukul-ai';

// Lazy singleton
let clientPromise: Promise<MongoClient> | null = null;

function getClientPromise(): Promise<MongoClient> {
  if (clientPromise) return clientPromise;

  const g = global as typeof globalThis & { _mongoClientPromise?: Promise<MongoClient> };

  if (process.env.NODE_ENV === 'development') {
    if (!g._mongoClientPromise) {
      g._mongoClientPromise = new MongoClient(uri).connect();
    }
    clientPromise = g._mongoClientPromise;
  } else {
    clientPromise = new MongoClient(uri).connect();
  }

  return clientPromise;
}

export default getClientPromise();

export async function getChunksCollection() {
  const client = await getClientPromise();
  return client.db().collection('chunks');
}

export async function getDocumentsCollection() {
  const client = await getClientPromise();
  return client.db().collection('documents');
}
