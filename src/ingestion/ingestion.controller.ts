import { Body, Controller, Post } from '@nestjs/common';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { IngestionService, IngestResult } from './ingestion.service';

@Controller('ingest')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  async ingest(@Body() dto: IngestDocumentDto): Promise<IngestResult> {
    return this.ingestionService.ingest(dto);
  }
}
