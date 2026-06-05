import { NextResponse } from 'next/server';
import { getChunksCollection } from '@/lib/mongodb';

export async function GET() {
  try {
    const collection = await getChunksCollection();
    const total = await collection.countDocuments();
    
    // Get a sample without embeddings
    const sample = await collection
      .find({}, { projection: { embedding: 0 } })
      .limit(5)
      .toArray();

    // Count by metadata type
    const byType = await collection.aggregate([
      { $group: { _id: '$metadata.type', count: { $sum: 1 } } }
    ]).toArray();

    return NextResponse.json({
      total,
      byType,
      sample: sample.map(d => ({
        id: d._id,
        content: d.content?.substring(0, 100) + '...',
        metadata: d.metadata,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
