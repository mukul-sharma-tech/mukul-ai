import { getChunksCollection } from './mongodb';
import { generateEmbedding } from './embeddings';

export interface SearchResult {
  content: string;
  metadata: any;
  score: number;
}

// Vector search using cosine similarity (works with local MongoDB)
export async function searchDocuments(query: string, limit: number = 5): Promise<SearchResult[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const collection = await getChunksCollection();
    
    const documents = await collection.find({}).toArray();
    
    const results = documents.map(doc => ({
      content: doc.content,
      metadata: doc.metadata,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }));
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  } catch (error) {
    console.error('Error searching documents:', error);
    return [];
  }
}

// Add a single document with embedding
export async function addDocument(content: string, metadata?: any): Promise<{ id: any; success: boolean }> {
  try {
    const embedding = await generateEmbedding(content);
    const collection = await getChunksCollection();
    
    const doc = {
      content,
      embedding,
      metadata: {
        ...metadata,
        createdAt: new Date(),
      },
    };
    
    const result = await collection.insertOne(doc);
    
    return {
      id: result.insertedId,
      success: true,
    };
  } catch (error) {
    console.error('Error adding document:', error);
    throw error;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Clear all documents
export async function clearAllDocuments(): Promise<number> {
  try {
    const collection = await getChunksCollection();
    const result = await collection.deleteMany({});
    return result.deletedCount;
  } catch (error) {
    console.error('Error clearing documents:', error);
    throw error;
  }
}

// Get document count
export async function getDocumentCount(): Promise<number> {
  try {
    const collection = await getChunksCollection();
    return await collection.countDocuments();
  } catch (error) {
    console.error('Error getting document count:', error);
    return 0;
  }
}
