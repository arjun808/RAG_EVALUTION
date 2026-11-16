export interface EvaluatedChunk {
  title: string;
  content: string;
  score?: number;
  [key: string]: unknown;
}

export interface GoldenItem {
  id: string;
  question: string;
  expectedDocument: string | null;
  keyPhrase: string | null;
  type: 'answerable' | 'unanswerable';
}

export interface RankedResult {
  isRelevant: boolean;
}

/**
 * Normalizes text: lowercases, collapses all whitespace into single spaces, and trims.
 */
export function normalize(text: string): string {
  if (!text) return '';
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Checks if a chunk is relevant to a golden query item:
 * chunk.title === item.expectedDocument AND normalize(chunk.content) includes normalize(item.keyPhrase)
 */
export function isRelevant(
  chunk: { title: string; content: string },
  item: { expectedDocument: string | null; keyPhrase: string | null },
): boolean {
  if (!item.expectedDocument || !item.keyPhrase) {
    return false;
  }
  if (chunk.title !== item.expectedDocument) {
    return false;
  }
  return normalize(chunk.content).includes(normalize(item.keyPhrase));
}

/**
 * Hit@K: 1 if any relevant chunk is in the top K, else 0.
 */
export function hitAtK(
  rankedResults: RankedResult[],
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = rankedResults.slice(0, k);
  return topK.some((r) => r.isRelevant) ? 1 : 0;
}

/**
 * Precision@K: count of relevant chunks in top K divided by K.
 */
export function precisionAtK(
  rankedResults: RankedResult[],
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = rankedResults.slice(0, k);
  const relevantCount = topK.filter((r) => r.isRelevant).length;
  return relevantCount / k;
}

/**
 * Recall@K: count of relevant chunks in top K divided by totalRelevant.
 */
export function recallAtK(
  rankedResults: RankedResult[],
  k: number,
  totalRelevant: number,
): number {
  if (k <= 0 || totalRelevant <= 0) return 0;
  const topK = rankedResults.slice(0, k);
  const relevantCount = topK.filter((r) => r.isRelevant).length;
  return relevantCount / totalRelevant;
}

/**
 * Reciprocal Rank: 1 / rank of the first relevant chunk (1-indexed), or 0 if none.
 */
export function reciprocalRank(
  rankedResults: RankedResult[],
): number {
  for (let i = 0; i < rankedResults.length; i++) {
    if (rankedResults[i].isRelevant) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Calculates the arithmetic mean of an array of numbers.
 */
export function average(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}
