import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      useClass: GeminiEmbeddingProvider,
    },
    GeminiEmbeddingProvider,
  ],
  exports: [EMBEDDING_PROVIDER, GeminiEmbeddingProvider],
})
export class EmbeddingModule {}
