import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SearchDto } from './dto/search.dto';
import { RetrievalService } from './retrieval.service';
import { SearchResponse } from './retrieval.types';

@Controller('retrieval')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  async search(@Body() dto: SearchDto): Promise<SearchResponse> {
    const results = await this.retrievalService.search(dto.query, dto.topK);
    return {
      query: dto.query,
      topK: dto.topK,
      results,
    };
  }
}
