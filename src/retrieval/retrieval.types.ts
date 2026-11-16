export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  title: string;
  source: string | null;
  score: number;
}

export interface SearchResponse {
  query: string;
  topK: number;
  results: RetrievedChunk[];
}
