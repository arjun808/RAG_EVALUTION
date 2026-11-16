# Production RAG Backend & Evaluation Pipeline

A high-performance, production-style **Retrieval-Augmented Generation (RAG)** backend built with **NestJS**, **TypeScript**, **PostgreSQL (`pgvector`)**, **Sequelize ORM**, and **Google Gemini Embeddings**.

Includes automated boundary-aware text chunking, idempotent document ingestion with SHA-256 deduplication, high-performance cosine similarity vector search, and a complete retrieval benchmarking suite with a golden dataset.

---

## 📑 Table of Contents

- [Architecture & Highlights](#-architecture--highlights)
- [Prerequisites](#-prerequisites)
- [Quick Start: 5-Step End-to-End Walkthrough](#-quick-start-5-step-end-to-end-walkthrough)
- [Environment Configuration](#-environment-configuration)
- [Database & Migrations](#-database--migrations)
- [API Endpoints & Testing with cURL](#-api-endpoints--testing-with-curl)
  - [1. Ingest Document (`POST /ingest`)](#1-ingest-document-post-ingest)
  - [2. Semantic Vector Search (`POST /retrieval/search`)](#2-semantic-vector-search-post-retrievalsearch)
- [Corpus Ingestion](#-corpus-ingestion)
- [Retrieval Evaluation & Benchmarking](#-retrieval-evaluation--benchmarking)
  - [Metrics Explained](#metrics-explained)
  - [Running the Benchmark](#running-the-benchmark)
  - [Understanding the Evaluation Logic](#understanding-the-evaluation-logic)
- [Database Inspection (`pgvector`)](#-database-inspection-pgvector)
- [Testing & Code Quality](#-testing--code-quality)
- [Troubleshooting & FAQs](#-troubleshooting--faqs)
- [Project Structure](#-project-structure)
- [License](#-license)

---

## 🚀 Architecture & Highlights

- **Recursive Text Chunker**: Hierarchy-aware splitter preferring paragraphs (`\n\n`) &rarr; lines (`\n`) &rarr; sentences (`. `, `! `, `? `) &rarr; spaces (` `) &rarr; character hard-cuts (`""`). Guarantees `chunk.length <= chunkSize` with smooth semantic overlap between consecutive chunks.
- **Google Gemini Embeddings**: Powered by `@google/genai` (`gemini-embedding-001` or `text-embedding-004`), supporting configurable `outputDimensionality` (default: 1536).
- **Resilient Network Layer**: Automatic batching (`EMBEDDING_BATCH_SIZE`), exponential backoff with randomized jitter for transient errors (HTTP 429 rate limits & 5xx server errors), and strict vector dimension validation.
- **Idempotent Ingestion**: Documents are hashed using SHA-256. Duplicate uploads are skipped instantly without opening transactions or creating redundant database entries.
- **Atomic Transactions & Vector Storage**: Documents and chunks are persisted atomically. Chunk embeddings are stored directly in PostgreSQL `vector(1536)` using parameterized SQL queries with zero text concatenation.
- **Rigorous Evaluation Suite**: Standalone evaluation script with a golden dataset (`data/golden.json`) calculating **Hit@K**, **Precision@K**, **Recall@K** (for K = 1, 3, 5), **MRR (Mean Reciprocal Rank)**, and similarity threshold baselines on unanswerable questions.

---

## 📦 Prerequisites

- **Node.js**: `v20.x` or higher
- **Docker & Docker Compose**: For running PostgreSQL with the `pgvector` extension and Redis.
- **Google Gemini API Key**: [Get a Gemini API Key](https://aistudio.google.com/app/apikey)

---

## ⚡ Quick Start: 5-Step End-to-End Walkthrough

Run the full system from scratch in under 3 minutes:

### Step 1: Install Dependencies & Setup `.env`
```bash
npm install
cp .env.example .env
```
Open `.env` and set your `GEMINI_API_KEY`:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

### Step 2: Start PostgreSQL with `pgvector`
```bash
docker compose up -d
```
*(Verify both containers are healthy: `docker compose ps`)*

### Step 3: Run Database Migrations
```bash
npm run db:migrate
```
*(Creates the `documents` and `chunks` tables with the `vector` extension).*

### Step 4: Start the NestJS Backend
```bash
npm run start:dev
```
The server will boot on `http://localhost:3000`.

### Step 5: Ingest Corpus & Benchmark Retrieval
In a second terminal window:
```bash
# 1. Ingest practice policy documents (data/docs/)
npm run ingest:folder

# 2. Run automated retrieval evaluation against data/golden.json
npm run eval:retrieval
```

---

## ⚙️ Environment Configuration

All environment variables are validated at startup via `class-validator` (see `src/config/env.validation.ts`). If any required variable is missing or malformed, the app fails fast with descriptive errors.

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | `number` | `3000` | Port the HTTP application listens on. |
| `NODE_ENV` | `string` | `development` | Runtime environment (`development`, `production`, `test`). |
| `DB_HOST` | `string` | `localhost` | PostgreSQL host. |
| `DB_PORT` | `number` | `5432` | PostgreSQL port. |
| `DB_USER` | `string` | `rag_user` | PostgreSQL username. |
| `DB_PASSWORD` | `string` | `rag_password` | PostgreSQL password. |
| `DB_NAME` | `string` | `rag_db` | PostgreSQL database name. |
| `GEMINI_API_KEY` | `string` | *(Required)* | Google Gemini API key. |
| `EMBEDDING_MODEL` | `string` | `gemini-embedding-001` | Gemini embedding model identifier. |
| `EMBEDDING_DIMENSIONS`| `number` | `1536` | Output vector dimension size. |
| `EMBEDDING_BATCH_SIZE`| `number` | `20` | Max number of chunks per embedding API call. |
| `CHUNK_SIZE` | `number` | `1000` | Maximum character length of each chunk. |
| `CHUNK_OVERLAP` | `number` | `200` | Target character overlap between consecutive chunks. |

---

## 🗄️ Database & Migrations

Database migrations are managed via Sequelize CLI (`db/migrations/`):

```bash
# Apply pending migrations
npm run db:migrate

# Check migration status
npm run db:migrate:status

# Undo the last migration (if needed)
npm run db:migrate:undo
```

### Schema Overview:
- **`documents`**:
  - `id`: UUID (Primary Key)
  - `title`: String (e.g. filename without extension)
  - `source`: String (relative file path or URL)
  - `content_hash`: SHA-256 hash of raw document content (Unique index for deduplication)
  - `metadata`: JSONB
  - `created_at`, `updated_at`: Timestamps
- **`chunks`**:
  - `id`: UUID (Primary Key)
  - `document_id`: UUID (Foreign Key &rarr; `documents.id`, indexed, cascade delete)
  - `chunk_index`: Integer (0-based chunk order)
  - `content`: Text (trimmed chunk payload)
  - `metadata`: JSONB
  - `embedding`: `vector(1536)` (pgvector vector representation)
  - `created_at`: Timestamp

---

## 🔌 API Endpoints & Testing with cURL

### 1. Ingest Document: `POST /ingest`

Splits text into boundary-aware chunks, generates vector embeddings, and stores everything in PostgreSQL within a single atomic transaction.

#### cURL (Bash / macOS / Linux):
```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "title": "refund-policy",
    "content": "Customers can return most items within 30 days of delivery for a full refund. Items must be unused.",
    "source": "data/docs/refund-policy.md",
    "metadata": { "department": "support" }
  }'
```

#### PowerShell (Windows):
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/ingest" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"title": "refund-policy", "content": "Customers can return most items within 30 days of delivery for a full refund.", "source": "data/docs/refund-policy.md"}'
```

#### Responses:
- **Success (`201 Created`):**
  ```json
  {
    "documentId": "5658e30c-840d-4295-a8a7-4406fd704fb4",
    "status": "created",
    "chunkCount": 3
  }
  ```
- **Idempotent duplicate check (`201 Created` / skipped):**
  ```json
  {
    "documentId": "5658e30c-840d-4295-a8a7-4406fd704fb4",
    "status": "skipped",
    "chunkCount": 3
  }
  ```

---

### 2. Semantic Vector Search: `POST /retrieval/search`

Embeds the incoming user query and searches PostgreSQL chunk vectors using cosine distance (`1 - (c.embedding <=> $1::vector) AS score`).

#### cURL (Bash / macOS / Linux):
```bash
curl -X POST http://localhost:3000/retrieval/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "How many days do I have to return an item?",
    "topK": 3
  }'
```

#### PowerShell (Windows):
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/retrieval/search" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"query": "How many days do I have to return an item?", "topK": 3}'
```

#### Response (`200 OK`):
```json
{
  "query": "How many days do I have to return an item?",
  "topK": 3,
  "results": [
    {
      "chunkId": "308bb708-f41d-4524-9ef9-1e278976a523",
      "documentId": "5658e30c-840d-4295-a8a7-4406fd704fb4",
      "chunkIndex": 0,
      "content": "Customers can return most items within 30 days of delivery for a full refund. The 30-day window starts on the delivery date shown in the tracking information, not the order date.",
      "title": "refund-policy",
      "source": "data/docs/refund-policy.md",
      "score": 0.7342
    }
  ]
}
```

---

## 📂 Corpus Ingestion

A batch ingestion script (`scripts/ingest-folder.ts`) scans a directory for `.md` and `.txt` files and ingests them sequentially:

```bash
# Ingest the built-in practice policies (data/docs/)
npm run ingest:folder

# Or ingest any custom folder:
npx ts-node scripts/ingest-folder.ts ./path/to/my-documents
```

**Features:**
- Automatic `title` extraction from file basenames.
- Sequential processing to respect Gemini API rate limits.
- Clear per-file reporting:
  ```text
  refund-policy.md: created (chunks: 2)
  shipping-policy.md: created (chunks: 2)
  warranty-policy.md: created (chunks: 2)
  ```

---

## 📊 Retrieval Evaluation & Benchmarking

The evaluation suite (`scripts/eval-retrieval.ts`) benchmarks your live RAG retrieval system against a golden test set (`data/golden.json`).

### Metrics Explained

| Metric | Formula | What It Tells You |
| :--- | :--- | :--- |
| **Hit Rate@K** | $\mathbb{I}(\text{relevant} \in \text{top } K)$ | Did the search find *at least one* relevant chunk in top $K$? |
| **Precision@K** | $\frac{\text{relevant in top } K}{K}$ | What fraction of retrieved chunks are useful (signal vs. noise)? |
| **Recall@K** | $\frac{\text{relevant in top } K}{\text{total relevant in DB}}$ | Did we find *all* chunks containing the answer in the corpus? |
| **MRR** | $\frac{1}{\text{rank of 1st relevant chunk}}$ | How close to the very top (rank 1) does the first answer appear? |
| **Score Analysis** | Top-1 score distribution | Calibrates similarity thresholds to reject unanswerable queries. |

### Running the Benchmark

```bash
# Run baseline evaluation
npm run eval:retrieval

# Run with a custom experiment label
npx ts-node scripts/eval-retrieval.ts --label chunk-size-500

# Run in CI mode with quality assertion (exits with code 1 if Hit@3 < 80%)
npx ts-node scripts/eval-retrieval.ts --min-hit-rate 0.80

# Specify a custom golden dataset
npx ts-node scripts/eval-retrieval.ts --golden ./path/to/my-golden.json
```

### Sample Evaluation Output

```text
======================================================
             RETRIEVAL EVALUATION REPORT [baseline]
======================================================

┌─────────┬─────────────┬────────┬────────┬────────┐
│ (index) │   Metric    │   @1   │   @3   │   @5   │
├─────────┼─────────────┼────────┼────────┼────────┤
│    0    │ 'Hit Rate'  │ '86.7%'│ '100%' │ '100%' │
│    1    │ 'Precision' │ '86.7%'│ '42.2%'│ '28.0%'│
│    2    │ 'Recall'    │ '73.3%'│ '93.3%'│ '100%' │
└─────────┴─────────────┴────────┴────────┴────────┘
MRR (Mean Reciprocal Rank): 0.9333
Evaluated Answerable Questions: 15
Unanswerable Questions: 2

--- Score Analysis (for Threshold Calibration) ---
Average Top-1 Score (Answerable):   0.7241
Average Top-1 Score (Unanswerable): 0.5060
Highest Top-1 Score (Unanswerable): 0.5120

Evaluation report saved to: eval-results/2026-11-16T14-20-00-baseline.json
```

### Understanding the Evaluation Logic

1. **Relevance Criteria**: A chunk is classified as relevant if:
   $$\text{chunk.title} == \text{item.expectedDocument} \quad \text{AND} \quad \text{normalize}(\text{chunk.content}) \supseteq \text{normalize}(\text{item.keyPhrase})$$
2. **PostgreSQL Ground-Truth Verification**: Before calculating recall, the evaluation script connects directly to PostgreSQL and counts how many chunks in the expected document actually contain `keyPhrase`. If a chunk boundary split the key phrase resulting in 0 matches, it is flagged as a `[LABEL PROBLEM]` so your metric stats stay mathematically sound.
3. **Threshold Calibration**: Look at `Highest Top-1 Score (Unanswerable)`. If out-of-domain queries never score above `0.52`, and answerable queries average `0.72`, setting a retrieval filter threshold of `score >= 0.60` will effectively block hallucinations and irrelevant questions.

---

## 🔍 Database Inspection (`pgvector`)

You can inspect documents and vector chunks directly inside PostgreSQL:

```bash
# Open PostgreSQL shell inside Docker
docker exec -it rag_postgres psql -U rag_user -d rag_db
```

Useful SQL queries:
```sql
-- Count documents and chunks
SELECT count(*) FROM documents;
SELECT count(*) FROM chunks;

-- View chunk contents and vector preview
SELECT id, document_id, chunk_index, LEFT(content, 60) AS content_preview, LEFT(embedding::text, 40) AS vector_preview
FROM chunks
ORDER BY created_at DESC
LIMIT 5;

-- Test vector cosine distance manually:
SELECT c.id, c.content, 1 - (c.embedding <=> (SELECT embedding FROM chunks LIMIT 1)) AS similarity
FROM chunks c
ORDER BY similarity DESC
LIMIT 3;
```

---

## 🧪 Testing & Code Quality

```bash
# Run all unit tests (Chunker, Embedding Provider, Retrieval Service, Metrics)
npm test

# Run ESLint validation
npm run lint

# Compile and verify TypeScript build
npm run build
```

---

## 💡 Troubleshooting & FAQs

### 1. `EADDRINUSE: 5432` when running Docker Compose
If you already have a local PostgreSQL instance running on port 5432, you can change the host port in `.env`:
```env
POSTGRES_PORT=5433
DB_PORT=5433
```
Then restart Docker: `docker compose up -d`.

### 2. Rate Limits on Gemini Free Tier (HTTP 429)
The project is pre-configured to handle rate limits:
- The `GeminiEmbeddingProvider` automatically retries with exponential backoff and jitter.
- The folder ingestion CLI processes files sequentially.
- The evaluation script pauses with `EVAL_DELAY_MS=700` between questions. You can increase this by setting `EVAL_DELAY_MS=1500` if needed.

### 3. Duplicate Document Handling
If you ingest the same file again, you will see `status: "skipped"`. This is intentional: `IngestionService` computes a SHA-256 hash of the content to prevent duplicate chunk embeddings in PostgreSQL.

---

## 📁 Project Structure

```text
Rag_evaluation/
├── data/
│   ├── docs/                     # Practice corpus documents
│   │   ├── refund-policy.md
│   │   ├── shipping-policy.md
│   │   └── warranty-policy.md
│   └── golden.json               # Benchmark dataset (17 test queries)
├── db/
│   ├── config.js                 # Sequelize database connection config
│   ├── migrations/               # PostgreSQL + pgvector schema migrations
│   └── seeders/
├── eval-results/                 # Saved JSON evaluation reports (git-ignored)
├── scripts/
│   ├── eval/
│   │   ├── metrics.ts            # Pure ranking and retrieval metric functions
│   │   └── metrics.spec.ts       # Metric unit tests
│   ├── eval-retrieval.ts         # Automated retrieval evaluation CLI
│   └── ingest-folder.ts          # Batch document ingestion CLI
├── src/
│   ├── config/
│   │   └── env.validation.ts     # Class-validator environment variable schema
│   ├── embedding/
│   │   ├── embedding-provider.interface.ts # Embedding interface & DI token
│   │   ├── gemini-embedding.provider.ts    # Google Gemini embedding service
│   │   ├── gemini-embedding.provider.spec.ts
│   │   └── embedding.module.ts
│   ├── ingestion/
│   │   ├── chunker.service.ts    # Recursive character text chunker
│   │   ├── chunker.service.spec.ts
│   │   ├── ingestion.controller.ts # POST /ingest
│   │   ├── ingestion.service.ts
│   │   ├── ingestion.module.ts
│   │   ├── dto/ingest-document.dto.ts
│   │   └── models/               # Sequelize TypeScript models (Document, Chunk)
│   ├── retrieval/
│   │   ├── retrieval.controller.ts # POST /retrieval/search
│   │   ├── retrieval.service.ts    # pgvector raw SQL cosine similarity search
│   │   ├── retrieval.service.spec.ts
│   │   ├── retrieval.types.ts
│   │   └── retrieval.module.ts
│   ├── app.module.ts
│   └── main.ts
├── docker-compose.yml            # PostgreSQL (pgvector:pg16) + Redis
├── package.json
└── tsconfig.json
```

---

## 📜 License

This project is licensed under the MIT License.
