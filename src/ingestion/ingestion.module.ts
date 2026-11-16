import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { EmbeddingModule } from '../embedding/embedding.module';
import { ChunkerService } from './chunker.service';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { ChunkModel } from './models/chunk.model';
import { DocumentModel } from './models/document.model';

@Module({
  imports: [
    SequelizeModule.forFeature([DocumentModel, ChunkModel]),
    EmbeddingModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, ChunkerService],
  exports: [IngestionService, ChunkerService],
})
export class IngestionModule {}
