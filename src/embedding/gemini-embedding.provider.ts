import { GoogleGenAI } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from './embedding-provider.interface';

@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(GeminiEmbeddingProvider.name);
  protected client: GoogleGenAI;
  private readonly modelName: string;
  private readonly dimensions: number;
  private readonly batchSize: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('GEMINI_API_KEY');
    this.modelName = this.configService.get<string>(
      'EMBEDDING_MODEL',
      'gemini-embedding-001',
    );
    this.dimensions = Number(
      this.configService.get<number>('EMBEDDING_DIMENSIONS', 1536),
    );
    this.batchSize = Number(
      this.configService.get<number>('EMBEDDING_BATCH_SIZE', 20),
    );

    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Allows replacing the GoogleGenAI client (used for unit testing with mocks).
   */
  setClient(client: GoogleGenAI): void {
    this.client = client;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const allEmbeddings: number[][] = [];
    const totalBatches = Math.ceil(texts.length / this.batchSize);

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batchIndex = Math.floor(i / this.batchSize) + 1;
      const batchTexts = texts.slice(i, i + this.batchSize);

      this.logger.log(
        `Embedding batch ${batchIndex}/${totalBatches} (${batchTexts.length} texts) using model '${this.modelName}'...`,
      );

      const batchVectors = await this.executeWithRetry(async () => {
        const response = await this.client.models.embedContent({
          model: this.modelName,
          contents: batchTexts,
          config: {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: this.dimensions,
          },
        });

        const rawEmbeddings = response.embeddings ?? [];
        if (rawEmbeddings.length !== batchTexts.length) {
          throw new Error(
            `Expected ${batchTexts.length} embeddings in batch ${batchIndex}, received ${rawEmbeddings.length}`,
          );
        }

        return rawEmbeddings.map((emb, idx) => {
          const values = emb.values;
          if (!values || values.length !== this.dimensions) {
            throw new Error(
              `Embedding vector dimension mismatch for item ${idx} in batch ${batchIndex}: expected ${this.dimensions}, got ${values?.length ?? 0}`,
            );
          }
          return values;
        });
      }, `embedDocuments batch ${batchIndex}/${totalBatches}`);

      allEmbeddings.push(...batchVectors);
    }

    return allEmbeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    return await this.executeWithRetry(async () => {
      const response = await this.client.models.embedContent({
        model: this.modelName,
        contents: [text],
        config: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: this.dimensions,
        },
      });

      const rawEmbeddings = response.embeddings ?? [];
      const first = rawEmbeddings[0];
      const values = first?.values;

      if (!values || values.length !== this.dimensions) {
        throw new Error(
          `Embedding vector dimension mismatch for query: expected ${this.dimensions}, got ${values?.length ?? 0}`,
        );
      }

      return values;
    }, 'embedQuery');
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxAttempts = 5,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts || !this.isRetryableError(error)) {
          throw error;
        }

        const baseDelay = 500 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 200;
        const delay = baseDelay + jitter;

        this.logger.warn(
          `${operationName} encountered transient error (attempt ${attempt}/${maxAttempts}). Retrying in ${Math.round(delay)}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const err = error as Record<string, unknown>;
    const status =
      typeof err.status === 'number' ? err.status : Number(err.status);
    const statusCode =
      typeof err.statusCode === 'number'
        ? err.statusCode
        : Number(err.statusCode);
    const code = typeof err.code === 'number' ? err.code : Number(err.code);

    const isTransientStatus = (val: number) =>
      val === 429 || (val >= 500 && val < 600);

    if (
      isTransientStatus(status) ||
      isTransientStatus(statusCode) ||
      isTransientStatus(code)
    ) {
      return true;
    }

    const message = typeof err.message === 'string' ? err.message : '';
    return (
      message.includes('429') ||
      message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('UNAVAILABLE') ||
      message.includes('INTERNAL')
    );
  }
}
