import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { EMBEDDING_PROVIDER } from '../embedding/embedding-provider.interface';
import type { EmbeddingProvider } from '../embedding/embedding-provider.interface';
import { RetrievedChunk } from './retrieval.types';

interface RawSearchResult {
  chunkId: string;
  documentId: string;
  chunkIndex: number | string;
  content: string;
  title: string;
  source: string | null;
  score: number | string;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @InjectConnection()
    private readonly sequelize: Sequelize,
  ) {}

  async search(query: string, topK: number): Promise<RetrievedChunk[]> {
    const embedStart = Date.now();
    const queryVector = await this.embeddingProvider.embedQuery(query);
    const embedDuration = Date.now() - embedStart;
    this.logger.log(`Query embedded in ${embedDuration}ms`);

    const vectorLiteral = `[${queryVector.join(',')}]`;

    const sqlStart = Date.now();
    const rows = await this.sequelize.query<RawSearchResult>(
      `SELECT c.id AS "chunkId", c.document_id AS "documentId",
              c.chunk_index AS "chunkIndex", c.content,
              d.title, d.source,
              1 - (c.embedding <=> $1::vector) AS score
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      {
        bind: [vectorLiteral, topK],
        type: QueryTypes.SELECT,
      },
    );
    const sqlDuration = Date.now() - sqlStart;
    this.logger.log(
      `SQL vector search completed in ${sqlDuration}ms (retrieved ${rows.length} chunks)`,
    );

    return rows.map((row) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      chunkIndex: Number(row.chunkIndex),
      content: row.content,
      title: row.title,
      source: row.source,
      score: Number(Number(row.score).toFixed(4)),
    }));
  }
}
