import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class IngestDocumentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
