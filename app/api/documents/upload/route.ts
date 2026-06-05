import { NextRequest, NextResponse } from 'next/server';
import { getChunksCollection } from '@/lib/mongodb';
import { generateEmbedding, chunkText } from '@/lib/embeddings';

// POST - Upload a text file to the vector database
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as string || 'resume';
    const source = formData.get('source') as string || 'uploaded-file';
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    // Read file content
    const content = await file.text();
    
    if (!content.trim()) {
      return NextResponse.json(
        { error: 'File is empty' },
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
          type,
          source,
          fileName: file.name,
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
      message: `File "${file.name}" uploaded successfully`,
      type,
      source,
      chunksCreated: chunks.length,
      insertedCount: result.insertedCount,
      documentIds: Object.values(result.insertedIds),
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json(
      { 
        error: 'Failed to upload file',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
