import ollama from 'ollama';

const EMBEDDING_MODEL = 'nomic-embed-text';

export interface EmbeddingResult {
  embedding: number[];
  text: string;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ollama.embeddings({
      model: EMBEDDING_MODEL,
      prompt: text,
    });
    return response.embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding. Make sure Ollama is running with nomic-embed-text model.');
  }
}

export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  
  return embeddings;
}

// Smart chunking that preserves semantic units
export function chunkText(text: string, maxChunkSize: number = 500, overlap: number = 50): string[] {
  const chunks: string[] = [];
  
  // Split by double newlines (sections) first
  const sections = text.split(/\n\s*\n/);
  
  for (const section of sections) {
    const trimmedSection = section.trim();
    if (!trimmedSection) continue;
    
    // If section is small enough, add as-is
    if (trimmedSection.length <= maxChunkSize) {
      chunks.push(trimmedSection);
    } else {
      // Split large sections by sentences
      const sentences = trimmedSection.split(/(?<=[.!?])\s+/);
      let currentChunk = '';
      
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 > maxChunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          // Small overlap
          const words = currentChunk.split(' ');
          if (words.length > 10) {
            currentChunk = words.slice(-5).join(' ') + ' ' + sentence;
          } else {
            currentChunk = sentence;
          }
        } else {
          currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentence;
        }
      }
      
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
    }
  }
  
  return chunks.filter(c => c.length > 20); // Filter out very short chunks
}

// Chunk with metadata for better context
export function chunkWithMetadata(text: string, type: string): { content: string; type: string }[] {
  const chunks: { content: string; type: string }[] = [];
  
  // Split by clear sections
  const lines = text.split('\n');
  let currentSection = '';
  let sectionType = type;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Detect section headers
    if (trimmedLine.match(/^(EXPERIENCE|EDUCATION|PROJECTS|SKILLS|ACHIEVEMENTS|Summary|Technical Skills)/i)) {
      if (currentSection.trim()) {
        chunks.push({ content: currentSection.trim(), type: sectionType });
      }
      currentSection = trimmedLine + '\n';
      sectionType = trimmedLine.toUpperCase();
    } else {
      currentSection += line + '\n';
    }
  }
  
  if (currentSection.trim()) {
    chunks.push({ content: currentSection.trim(), type: sectionType });
  }
  
  return chunks;
}
