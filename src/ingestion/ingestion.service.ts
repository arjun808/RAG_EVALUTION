import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { createHash } from 'crypto';
import { Sequelize } from 'sequelize-typescript';
import { EMBEDDING_PROVIDER } from '../embedding/embedding-provider.interface';
import type { EmbeddingProvider } from '../embedding/embedding-provider.interface';
import { ChunkerService } from './chunker.service';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { ChunkModel } from './models/chunk.model';
import { DocumentModel } from './models/document.model';

export interface IngestResult {
  documentId: string;
  status: 'created' | 'skipped';
  chunkCount: number;
}

@Injectable()
export class IngestionService {
  constructor(
    @InjectModel(DocumentModel)
    private readonly documentModel: typeof DocumentModel,
    @InjectModel(ChunkModel)
    private readonly chunkModel: typeof ChunkModel,
    @InjectConnection()
    private readonly sequelize: Sequelize,
    private readonly configService: ConfigService,
    private readonly chunkerService: ChunkerService,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  async ingest(dto: IngestDocumentDto): Promise<IngestResult> {
    const contentHash = createHash('sha256').update(dto.content).digest('hex');

    const existingDoc = await this.documentModel.findOne({
      where: { contentHash },
    });

    if (existingDoc) {
      const chunkCount = await this.chunkModel.count({
        where: { documentId: existingDoc.id },
      });
      return {
        documentId: existingDoc.id,
        status: 'skipped',
        chunkCount,
      };
    }

    const chunkSize = Number(
      this.configService.get<number>('CHUNK_SIZE', 1000),
    );
    const chunkOverlap = Number(
      this.configService.get<number>('CHUNK_OVERLAP', 200),
    );

    const chunkTexts = this.chunkerService.chunk(
      dto.content,
      chunkSize,
      chunkOverlap,
    );

    let embeddings: number[][];
    try {
      embeddings = await this.embeddingProvider.embedDocuments(chunkTexts);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Embedding generation failed';
      throw new BadGatewayException(
        `Failed to generate embeddings: ${message}`,
      );
    }

    return await this.sequelize.transaction(async (transaction) => {
      const document = await this.documentModel.create(
        {
          title: dto.title,
          source: dto.source ?? null,
          contentHash,
          metadata: dto.metadata ?? {},
        },
        { transaction },
      );

      const chunkRecords = chunkTexts.map((content, chunkIndex) => ({
        documentId: document.id,
        chunkIndex,
        content,
        metadata: dto.metadata ?? {},
      }));

      let createdChunks: ChunkModel[] = [];
      if (chunkRecords.length > 0) {
        createdChunks = await this.chunkModel.bulkCreate(chunkRecords, {
          transaction,
          returning: true,
        });
      }

      for (let i = 0; i < createdChunks.length; i++) {
        const chunk = createdChunks[i];
        const vectorStr = `[${embeddings[i].join(',')}]`;
        await this.sequelize.query(
          'UPDATE chunks SET embedding = $1::vector WHERE id = $2',
          {
            bind: [vectorStr, chunk.id],
            transaction,
          },
        );
      }

      return {
        documentId: document.id,
        status: 'created',
        chunkCount: chunkTexts.length,
      };
    });
  }
}
