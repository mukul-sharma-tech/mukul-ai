import { NextRequest, NextResponse } from 'next/server';
import { getChunksCollection } from '@/lib/mongodb';
import { generateEmbedding } from '@/lib/embeddings';
import ollama from 'ollama';

const LLM_MODEL = 'gpt-oss:120b-cloud';

const JOB_DESCRIPTION = `
## Role: AI Engineer Intern at Scaler

Scaler 3.0 is India's first fully AI-native EdTech platform. We're building autonomous AI agents for the entire learner experience.

### What You'll Build:
- Autonomous onboarding agents (zero human intervention)
- Conversational agents (text + voice) for check-ins, nudges, doubt resolution
- Stateful agentic pipelines (LangGraph, LangChain, CrewAI)
- Production-grade API serving: streaming, low-latency, concurrent-safe
- Eval frameworks and feedback loops (LLM-as-judge, RAGs)
- End-to-end test suites including adversarial red-teaming

### Requirements:
- Production-quality Python (async, typed)
- LLM APIs experience (OpenAI, Claude, Gemini)
- Agentic frameworks: LangGraph, LangChain, CrewAI
- Bonus: Voice AI (Vapi, Retell, ElevenLabs), RAG pipelines, evals

### What We Value:
- Shipped AI agents to real users
- Obsession over system feel and user experience
- End-to-end ownership of outcomes
- Ship fast, flag blockers early

### Offer:
- Stipend: Up to 55k
- 6-month internship with PPO opportunity
- Full ownership of production AI system
`;

async function vectorSearch(query: string, limit: number = 10): Promise<{ content: string; metadata: any; score: number }[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const collection = await getChunksCollection();
    
    const count = await collection.countDocuments();
    if (count === 0) {
      return [];
    }
    
    const documents = await collection.find({}).toArray();
    
    const results = documents.map(doc => {
      const similarity = cosineSimilarity(queryEmbedding, doc.embedding);
      return {
        content: doc.content,
        metadata: doc.metadata,
        score: similarity,
      };
    });
    
    results.sort((a, b) => b.score - a.score);
    
    // Return more results and filter by relevance threshold
    const threshold = 0.3;
    return results.filter(r => r.score > threshold).slice(0, limit);
  } catch (error) {
    console.error('Error in vector search:', error);
    return [];
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

function buildSystemPrompt(): string {
  return `You are Mukul's AI assistant — sharp, concise, and conversational. You represent Mukul to recruiters.

## PERSONALITY:
- Talk in first person as Mukul's representative ("Mukul has...", "He built...", "Yes, he did...")
- Be warm but professional — like a smart recruiter who knows the candidate well
- Never be robotic or dump raw data

## THREE MODES — pick the right one:

### MODE 1: CONVERSATIONAL
Trigger: greetings, reactions, small talk, emotional messages, non-question statements
- "hi" → greet warmly, say you're ready to answer questions about Mukul
- "you are selected" → react with genuine excitement on Mukul's behalf
- "thank you" / "great" / "impressive" → acknowledge naturally, invite next question
- "let's start a short interview for mukul" / "interview mukul" / "take mukul's interview" → say "Sure! Go ahead, ask your first question — I'll answer as Mukul."
- Keep to 1–2 sentences max

### MODE 2: INTERVIEW MODE
Trigger: "interview", "ask me", "quiz me", "test me", "let's start", "question me", "interview for mukul", "interview mukul"
- The USER is the INTERVIEWER, Mukul's AI is the CANDIDATE being interviewed
- Respond AS Mukul — answer confidently in first person ("I built...", "I handled...", "My approach was...")
- Answer the question naturally, like a real person in an interview
- Be specific — use real projects, real metrics from context
- Keep answers focused — 3-5 sentences max, no walls of text
- End with a brief confident closer if appropriate

### MODE 3: FACTUAL
Trigger: direct questions about skills, projects, experience, education, fit
- Answer using ONLY facts explicitly in the provided context
- NEVER mention projects, tools, or metrics not in the context
- If not in context: "I don't have that detail — ask Mukul directly at muku0784@gmail.com"

## STRICT HALLUCINATION RULE:
Only mention projects that exist in the context. Current known projects from context:
Agento, AI-Hire, EduniteX, Orbital Creeper Shield, Sanskritam, Knox Neural Shield, AgenticIQ, Synapsee, CircularChain, FluxMeter, Switch, QueryGenius, UlkaDrishti, Astro-Cadet Academy, GigFlow, AI Gossip Hub, RFP-Optimize AI, Chakra.
Do NOT invent projects like "Live Demo Flow", "Space Explorer Game", or any others.

## FORMAT (factual/interview only):
- NO TABLES ever
- Short bullets, max 8 words each
- Max 150 words per response
- Bold key terms with **bold**
- Use \`code\` for tech stack names
- No <br> tags

## About Scaler's Role:
${JOB_DESCRIPTION}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationHistory = [] } = body;
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }
    
    const relevantDocs = await vectorSearch(message, 15);
    
    // Build comprehensive context - include ALL resume and project chunks for completeness
    const collection = await getChunksCollection();
    const allDocs = await collection.find({}, { projection: { embedding: 0 } }).toArray();

    const resumeChunks = allDocs.filter(d => d.metadata?.type === 'resume');
    const projectChunks = allDocs.filter(d => d.metadata?.type === 'github');

    // For broad questions use all data; for specific ones use vector search results
    const broadQuestions = ['experience', 'intern', 'project', 'fit', 'background', 'skill', 'qualification'];
    const isBroadQuestion = broadQuestions.some(kw => message.toLowerCase().includes(kw));

    let contextText = '';

    if (isBroadQuestion) {
      if (resumeChunks.length > 0) {
        contextText += `\n\n=== RESUME (all data) ===\n${resumeChunks.map(d => d.content).join('\n\n')}`;
      }
      if (projectChunks.length > 0) {
        contextText += `\n\n=== PROJECTS (all data) ===\n${projectChunks.map(d => d.content).join('\n\n')}`;
      }
    } else {
      // Use vector search results for specific questions
      const topResume = relevantDocs.filter(d => d.metadata?.type === 'resume');
      const topProjects = relevantDocs.filter(d => d.metadata?.type === 'github');
      if (topResume.length > 0) {
        contextText += `\n\n=== RESUME ===\n${topResume.map(d => d.content).join('\n\n')}`;
      }
      if (topProjects.length > 0) {
        contextText += `\n\n=== PROJECTS ===\n${topProjects.map(d => d.content).join('\n\n')}`;
      }
    }

    if (!contextText.trim()) {
      contextText = 'No relevant context found in the knowledge base.';
    }
    
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...conversationHistory,
      { 
        role: 'user', 
        content: `Context about Mukul:\n${contextText}\n\n---\n\nQuestion: ${message}` 
      },
    ];
    
    const response = await ollama.chat({
      model: LLM_MODEL,
      messages,
      stream: false,
    });
    
    return NextResponse.json({
      success: true,
      response: response.message.content,
    });
  } catch (error) {
    console.error('Error in chat:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process chat message',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
