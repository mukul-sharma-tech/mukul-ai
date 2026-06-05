import { NextRequest, NextResponse } from 'next/server';
import { getChunksCollection } from '@/lib/mongodb';
import { generateEmbedding, chunkText } from '@/lib/embeddings';

// POST - Add a new document to the vector database
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, metadata } = body;
    
    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required and must be a string' },
        { status: 400 }
      );
    }
    
    // Chunk the document with smaller chunks for better retrieval
    const chunks = chunkText(content, 500, 50);
    
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
          chunkIndex: i,
          totalChunks: chunks.length,
          createdAt: new Date(),
        },
      };
      
      documents.push(doc);
    }
    
    // Insert all chunks
    const result = await collection.insertMany(documents);
    
    return NextResponse.json({
      success: true,
      message: `Document added successfully with ${chunks.length} chunks`,
      insertedCount: result.insertedCount,
      documentIds: Object.values(result.insertedIds),
    });
  } catch (error) {
    console.error('Error adding document:', error);
    return NextResponse.json(
      { 
        error: 'Failed to add document',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET - List all documents
export async function GET() {
  try {
    const collection = await getChunksCollection();
    const documents = await collection
      .find({}, { projection: { embedding: 0 } })
      .sort({ 'metadata.createdAt': -1 })
      .limit(100)
      .toArray();
    
    return NextResponse.json({
      success: true,
      count: documents.length,
      documents,
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}

// DELETE - Delete all documents
export async function DELETE() {
  try {
    const collection = await getChunksCollection();
    const result = await collection.deleteMany({});
    
    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error deleting documents:', error);
    return NextResponse.json(
      { error: 'Failed to delete documents' },
      { status: 500 }
    );
  }
}
