import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import {
  average,
  hitAtK,
  isRelevant,
  normalize,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from './eval/metrics';

dotenv.config();

interface GoldenItem {
  id: string;
  question: string;
  expectedDocument: string | null;
  keyPhrase: string | null;
  type: 'answerable' | 'unanswerable';
}

interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  title: string;
  source: string | null;
  score: number;
}

interface SearchResponse {
  query: string;
  topK: number;
  results: RetrievedChunk[];
}

interface QuestionEvaluationDetail {
  id: string;
  question: string;
  type: 'answerable' | 'unanswerable';
  expectedDocument: string | null;
  keyPhrase: string | null;
  totalRelevantInDb?: number;
  isLabelProblem?: boolean;
  top1Score: number;
  hitAt1?: number;
  hitAt3?: number;
  hitAt5?: number;
  precisionAt1?: number;
  precisionAt3?: number;
  precisionAt5?: number;
  recallAt1?: number;
  recallAt3?: number;
  recallAt5?: number;
  reciprocalRank?: number;
  retrievedChunks: Array<{
    chunkId: string;
    title: string;
    score: number;
    contentExcerpt: string;
    isRelevant: boolean;
  }>;
}

function parseCliArgs(): {
  goldenPath: string;
  label: string;
  minHitRate?: number;
} {
  const args = process.argv.slice(2);
  let goldenPath = './data/golden.json';
  let label = 'baseline';
  let minHitRate: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--golden' && i + 1 < args.length) {
      goldenPath = args[i + 1];
      i++;
    } else if (args[i] === '--label' && i + 1 < args.length) {
      label = args[i + 1];
      i++;
    } else if (args[i] === '--min-hit-rate' && i + 1 < args.length) {
      minHitRate = parseFloat(args[i + 1]);
      i++;
    }
  }

  return { goldenPath, label, minHitRate };
}

async function callSearchWithRetry(
  apiUrl: string,
  query: string,
  topK = 5,
  maxAttempts = 3,
): Promise<SearchResponse> {
  const endpoint = `${apiUrl}/retrieval/search`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return (await response.json()) as SearchResponse;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const delay = attempt * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Search failed after retries.');
}

async function main(): Promise<void> {
  const { goldenPath, label, minHitRate } = parseCliArgs();
  const resolvedGolden = path.resolve(process.cwd(), goldenPath);

  if (!fs.existsSync(resolvedGolden)) {
    console.error(`Golden dataset not found at: ${resolvedGolden}`);
    process.exit(1);
  }

  const rawGolden = fs.readFileSync(resolvedGolden, 'utf-8');
  const goldenItems: GoldenItem[] = JSON.parse(rawGolden) as GoldenItem[];

  const apiUrl = (process.env.EVAL_API_URL || 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  const evalDelayMs = Number(process.env.EVAL_DELAY_MS || '700');

  // Connect to PostgreSQL to calculate totalRelevant for answerable questions
  const pgClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'rag_user',
    password: process.env.DB_PASSWORD || 'rag_password',
    database: process.env.DB_NAME || 'rag_db',
  });

  try {
    await pgClient.connect();
  } catch (err) {
    console.error(
      `Could not connect to PostgreSQL database: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  console.log(`Starting retrieval evaluation (label: ${label})...`);
  console.log(`Golden dataset: ${resolvedGolden} (${goldenItems.length} questions)`);
  console.log(`Target API: ${apiUrl}/retrieval/search (delay: ${evalDelayMs}ms)\n`);

  const details: QuestionEvaluationDetail[] = [];
  const failures: QuestionEvaluationDetail[] = [];

  for (let i = 0; i < goldenItems.length; i++) {
    const item = goldenItems[i];
    if (i > 0 && evalDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, evalDelayMs));
    }

    try {
      const searchRes = await callSearchWithRetry(apiUrl, item.question, 5);
      const retrieved = searchRes.results ?? [];
      const top1Score = retrieved[0]?.score ?? 0;

      if (item.type === 'unanswerable') {
        details.push({
          id: item.id,
          question: item.question,
          type: item.type,
          expectedDocument: null,
          keyPhrase: null,
          top1Score,
          retrievedChunks: retrieved.map((c) => ({
            chunkId: c.chunkId,
            title: c.title,
            score: c.score,
            contentExcerpt: c.content.slice(0, 80),
            isRelevant: false,
          })),
        });
        continue;
      }

      // Answerable: query PostgreSQL to determine totalRelevant chunks in DB
      let totalRelevant = 0;
      if (item.expectedDocument && item.keyPhrase) {
        const queryResult = await pgClient.query<{ content: string }>(
          `SELECT c.content
           FROM chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE d.title = $1`,
          [item.expectedDocument],
        );

        const normKeyPhrase = normalize(item.keyPhrase);
        totalRelevant = queryResult.rows.filter((row) =>
          normalize(row.content).includes(normKeyPhrase),
        ).length;
      }

      if (totalRelevant === 0) {
        console.warn(
          `[Label Problem] ${item.id}: Key phrase "${item.keyPhrase}" was not found in any chunks of "${item.expectedDocument}". Excluding from metric averages.`,
        );
        details.push({
          id: item.id,
          question: item.question,
          type: item.type,
          expectedDocument: item.expectedDocument,
          keyPhrase: item.keyPhrase,
          totalRelevantInDb: 0,
          isLabelProblem: true,
          top1Score,
          retrievedChunks: retrieved.map((c) => ({
            chunkId: c.chunkId,
            title: c.title,
            score: c.score,
            contentExcerpt: c.content.slice(0, 80),
            isRelevant: isRelevant(c, item),
          })),
        });
        continue;
      }

      // Compute ranking relevance for retrieved chunks
      const rankedResults = retrieved.map((c) => ({
        ...c,
        isRelevant: isRelevant(c, item),
      }));

      const hit1 = hitAtK(rankedResults, 1);
      const hit3 = hitAtK(rankedResults, 3);
      const hit5 = hitAtK(rankedResults, 5);

      const prec1 = precisionAtK(rankedResults, 1);
      const prec3 = precisionAtK(rankedResults, 3);
      const prec5 = precisionAtK(rankedResults, 5);

      const rec1 = recallAtK(rankedResults, 1, totalRelevant);
      const rec3 = recallAtK(rankedResults, 3, totalRelevant);
      const rec5 = recallAtK(rankedResults, 5, totalRelevant);

      const rr = reciprocalRank(rankedResults);

      const detail: QuestionEvaluationDetail = {
        id: item.id,
        question: item.question,
        type: item.type,
        expectedDocument: item.expectedDocument,
        keyPhrase: item.keyPhrase,
        totalRelevantInDb: totalRelevant,
        isLabelProblem: false,
        top1Score,
        hitAt1: hit1,
        hitAt3: hit3,
        hitAt5: hit5,
        precisionAt1: prec1,
        precisionAt3: prec3,
        precisionAt5: prec5,
        recallAt1: rec1,
        recallAt3: rec3,
        recallAt5: rec5,
        reciprocalRank: rr,
        retrievedChunks: rankedResults.map((c) => ({
          chunkId: c.chunkId,
          title: c.title,
          score: c.score,
          contentExcerpt: c.content.slice(0, 80),
          isRelevant: c.isRelevant,
        })),
      };

      details.push(detail);

      if (hit5 === 0) {
        failures.push(detail);
      }
    } catch (err) {
      console.error(
        `Error evaluating ${item.id} ("${item.question}"): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await pgClient.end();

  // Aggregate metrics for answerable questions (excluding label problems)
  const validAnswerable = details.filter(
    (d) => d.type === 'answerable' && !d.isLabelProblem,
  );
  const unanswerable = details.filter((d) => d.type === 'unanswerable');

  const meanHitAt1 = average(validAnswerable.map((d) => d.hitAt1 ?? 0));
  const meanHitAt3 = average(validAnswerable.map((d) => d.hitAt3 ?? 0));
  const meanHitAt5 = average(validAnswerable.map((d) => d.hitAt5 ?? 0));

  const meanPrecAt1 = average(validAnswerable.map((d) => d.precisionAt1 ?? 0));
  const meanPrecAt3 = average(validAnswerable.map((d) => d.precisionAt3 ?? 0));
  const meanPrecAt5 = average(validAnswerable.map((d) => d.precisionAt5 ?? 0));

  const meanRecAt1 = average(validAnswerable.map((d) => d.recallAt1 ?? 0));
  const meanRecAt3 = average(validAnswerable.map((d) => d.recallAt3 ?? 0));
  const meanRecAt5 = average(validAnswerable.map((d) => d.recallAt5 ?? 0));

  const mrr = average(validAnswerable.map((d) => d.reciprocalRank ?? 0));

  const avgAnswerableTop1 = average(validAnswerable.map((d) => d.top1Score));
  const avgUnanswerableTop1 = average(unanswerable.map((d) => d.top1Score));
  const maxUnanswerableTop1 =
    unanswerable.length > 0
      ? Math.max(...unanswerable.map((d) => d.top1Score))
      : 0;

  console.log('\n======================================================');
  console.log(`             RETRIEVAL EVALUATION REPORT [${label}]`);
  console.log('======================================================\n');

  console.table([
    {
      Metric: 'Hit Rate',
      '@1': (meanHitAt1 * 100).toFixed(1) + '%',
      '@3': (meanHitAt3 * 100).toFixed(1) + '%',
      '@5': (meanHitAt5 * 100).toFixed(1) + '%',
    },
    {
      Metric: 'Precision',
      '@1': (meanPrecAt1 * 100).toFixed(1) + '%',
      '@3': (meanPrecAt3 * 100).toFixed(1) + '%',
      '@5': (meanPrecAt5 * 100).toFixed(1) + '%',
    },
    {
      Metric: 'Recall',
      '@1': (meanRecAt1 * 100).toFixed(1) + '%',
      '@3': (meanRecAt3 * 100).toFixed(1) + '%',
      '@5': (meanRecAt5 * 100).toFixed(1) + '%',
    },
  ]);

  console.log(`MRR (Mean Reciprocal Rank): ${mrr.toFixed(4)}`);
  console.log(`Evaluated Answerable Questions: ${validAnswerable.length}`);
  console.log(
    `Excluded (Label Problems): ${details.filter((d) => d.isLabelProblem).length}`,
  );
  console.log(`Unanswerable Questions: ${unanswerable.length}\n`);

  console.log('--- Score Analysis (for Threshold Calibration) ---');
  console.log(
    `Average Top-1 Score (Answerable):   ${avgAnswerableTop1.toFixed(4)}`,
  );
  console.log(
    `Average Top-1 Score (Unanswerable): ${avgUnanswerableTop1.toFixed(4)}`,
  );
  console.log(
    `Highest Top-1 Score (Unanswerable): ${maxUnanswerableTop1.toFixed(4)}\n`,
  );

  if (failures.length > 0) {
    console.log('======================================================');
    console.log(`                      FAILURES (${failures.length})`);
    console.log('======================================================');
    for (const failure of failures) {
      console.log(`\n[${failure.id}] "${failure.question}"`);
      console.log(`  Expected Document: ${failure.expectedDocument}`);
      console.log(`  Key Phrase:        "${failure.keyPhrase}"`);
      console.log('  Top 3 Retrieved Chunks:');
      const top3 = failure.retrievedChunks.slice(0, 3);
      for (let rank = 0; rank < top3.length; rank++) {
        const c = top3[rank];
        console.log(
          `    #${rank + 1} [score: ${c.score.toFixed(4)}] ${c.title}: "${c.contentExcerpt}..."`,
        );
      }
    }
    console.log();
  } else {
    console.log('All answerable questions retrieved at least one relevant chunk in top 5!\n');
  }

  // Save report to eval-results/<timestamp>-<label>.json
  const evalDir = path.resolve(process.cwd(), 'eval-results');
  if (!fs.existsSync(evalDir)) {
    fs.mkdirSync(evalDir, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const reportPath = path.join(evalDir, `${timestamp}-${label}.json`);

  const report = {
    label,
    date: new Date().toISOString(),
    config: {
      CHUNK_SIZE: process.env.CHUNK_SIZE ?? '1000',
      CHUNK_OVERLAP: process.env.CHUNK_OVERLAP ?? '200',
      EMBEDDING_MODEL: process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001',
      EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS ?? '1536',
    },
    metrics: {
      hitAt1: meanHitAt1,
      hitAt3: meanHitAt3,
      hitAt5: meanHitAt5,
      precisionAt1: meanPrecAt1,
      precisionAt3: meanPrecAt3,
      precisionAt5: meanPrecAt5,
      recallAt1: meanRecAt1,
      recallAt3: meanRecAt3,
      recallAt5: meanRecAt5,
      mrr,
      avgAnswerableTop1,
      avgUnanswerableTop1,
      maxUnanswerableTop1,
      totalAnswerable: validAnswerable.length,
      totalUnanswerable: unanswerable.length,
      labelProblems: details.filter((d) => d.isLabelProblem).length,
    },
    details,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Evaluation report saved to: ${reportPath}`);

  if (minHitRate !== undefined) {
    if (meanHitAt5 < minHitRate) {
      console.error(
        `\nFAILED: Hit@5 (${(meanHitAt5 * 100).toFixed(1)}%) is below minimum threshold (${(minHitRate * 100).toFixed(1)}%).`,
      );
      process.exit(1);
    } else {
      console.log(
        `PASSED: Hit@5 (${(meanHitAt5 * 100).toFixed(1)}%) meets minimum threshold (${(minHitRate * 100).toFixed(1)}%).`,
      );
    }
  }
}

void main();
