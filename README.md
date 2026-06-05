# Mukul AI - RAG-Powered Chat Interface

A chat interface that answers questions about Mukul using RAG (Retrieval-Augmented Generation) with MongoDB vector storage and Ollama embeddings.

## Features

- **Chat Interface**: Public URL accessible chatbot for recruiters
- **RAG-Grounded Responses**: Answers based on actual resume and GitHub repos
- **MongoDB Vector Store**: Store and retrieve document embeddings
- **Ollama Embeddings**: Local embedding generation using `nomic-embed-text`
- **Document Ingestion**: API to add resume data, GitHub repo info, etc.

## Prerequisites

1. **MongoDB** - Running locally or connection string in `.env.local`
2. **Ollama** - For embeddings and LLM
   ```bash
   # Install Ollama from https://ollama.ai
   
   # Pull required models
   ollama pull nomic-embed-text  # For embeddings
   ollama pull llama3.2          # For chat completions
   ```

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## API Endpoints

### POST `/api/documents`
Add a document to the vector database.

**Request Body:**
```json
{
  "content": "Your document text here...",
  "metadata": {
    "type": "resume",
    "source": "resume-section"
  }
}
```

### POST `/api/documents/ingest`
Ingest documents with type categorization (resume, github, project).

**Request Body:**
```json
{
  "content": "Document content...",
  "type": "github",
  "source": "github-repo-name",
  "metadata": {
    "repoUrl": "https://github.com/user/repo",
    "stars": 50
  }
}
```

### POST `/api/chat`
Send a chat message.

**Request Body:**
```json
{
  "message": "Why are you the right person for this role?",
  "conversationHistory": []
}
```

### GET `/api/documents`
List all stored documents.

### DELETE `/api/documents`
Delete all documents.

## Usage with Postman

1. **Ingest Resume Data:**
   - POST to `/api/documents`
   - Add resume sections as content

2. **Ingest GitHub Repos:**
   - POST to `/api/documents/ingest`
   - Set type to "github" and include README content

3. **Test Chat:**
   - POST to `/api/chat` with questions
   - The bot will retrieve relevant context and generate responses
   npm run clean
npm run ingest          # resume + projects.txt
npm run ingest:github   # all 17 GitHub READMEs


## Environment Variables

Create `.env.local`:
```
MONGODB_URI=mongodb://localhost:27017/mukul-ai
OLLAMA_BASE_URL=http://localhost:11434
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: MongoDB (vector storage)
- **Embeddings**: Ollama (nomic-embed-text)
- **LLM**: Ollama (llama3.2 or similar)

## Architecture

```
User Question
     ↓
[Generate Query Embedding]
     ↓
[Vector Search in MongoDB]
     ↓
[Retrieve Relevant Documents]
     ↓
[Build Context + Prompt]
     ↓
[Ollama LLM Response]
     ↓
Return Answer
```
