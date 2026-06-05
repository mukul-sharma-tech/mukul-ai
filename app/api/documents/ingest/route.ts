import { NextRequest, NextResponse } from 'next/server';
import { getChunksCollection } from '@/lib/mongodb';
import { generateEmbedding, chunkText } from '@/lib/embeddings';

// POST - Ingest a document with metadata (for resume, GitHub repos, etc.)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, type, source, metadata = {} } = body;
    
    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required and must be a string' },
        { status: 400 }
      );
    }
    
    if (!type) {
      return NextResponse.json(
        { error: 'Document type is required (e.g., "resume", "github", "project")' },
        { status: 400 }
      );
    }
    
    // Chunk the document
    const chunks = chunkText(content, 800, 150);
    
    if (chunks.length === 0) {
      return NextResponse.json(
        { error: 'No valid content to process' },
        { status: 400 }
      );
    }
    
    const collection = await getChunksCollection();
    const documents = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await generateEmbedding(chunk);
      
      const doc = {
        content: chunk,
        embedding,
        metadata: {
          ...metadata,
          type,
          source: source || 'unknown',
          chunkIndex: i,
          totalChunks: chunks.length,
          createdAt: new Date(),
        },
      };
      
      documents.push(doc);
    }
    
    const result = await collection.insertMany(documents);
    
    return NextResponse.json({
      success: true,
      message: `Document ingested successfully`,
      type,
      chunksCreated: chunks.length,
      insertedCount: result.insertedCount,
      documentIds: Object.values(result.insertedIds),
    });
  } catch (error) {
    console.error('Error ingesting document:', error);
    return NextResponse.json(
      { 
        error: 'Failed to ingest document',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET - Get statistics about ingested documents
export async function GET() {
  try {
    const collection = await getChunksCollection();
    
    const totalDocs = await collection.countDocuments();
    
    const typeStats = await collection.aggregate([
      { $group: { _id: '$metadata.type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();
    
    const sourceStats = await collection.aggregate([
      { $group: { _id: '$metadata.source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray();
    
    return NextResponse.json({
      success: true,
      totalDocuments: totalDocs,
      byType: typeStats,
      bySource: sourceStats,
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    return NextResponse.json(
      { error: 'Failed to get statistics' },
      { status: 500 }
    );
  }
}
