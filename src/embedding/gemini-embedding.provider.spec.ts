import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';

describe('GeminiEmbeddingProvider', () => {
  let provider: GeminiEmbeddingProvider;
  let mockEmbedContent: jest.Mock;
  let mockConfigService: Partial<ConfigService>;
  const EXPECTED_DIMENSIONS = 1536;
  const BATCH_SIZE = 2;

  beforeEach(async () => {
    mockEmbedContent = jest.fn();
    const mockClient = {
      models: {
        embedContent: mockEmbedContent,
      },
    } as unknown as GoogleGenAI;

    mockConfigService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
        throw new Error(`Unexpected key: ${key}`);
      }),
      get: jest
        .fn()
        .mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'EMBEDDING_MODEL') return 'gemini-embedding-001';
          if (key === 'EMBEDDING_DIMENSIONS') return EXPECTED_DIMENSIONS;
          if (key === 'EMBEDDING_BATCH_SIZE') return BATCH_SIZE;
          return defaultValue;
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        GeminiEmbeddingProvider,
      ],
    }).compile();

    provider = module.get<GeminiEmbeddingProvider>(GeminiEmbeddingProvider);
    provider.setClient(mockClient);
  });

  const createDummyVector = (dim = EXPECTED_DIMENSIONS) =>
    Array.from({ length: dim }, (_, i) => i * 0.001);

  describe('embedDocuments - batching', () => {
    it('should split 5 texts into batches of size 2 and return all embeddings in order', () => {
      return (async () => {
        const texts = ['text 1', 'text 2', 'text 3', 'text 4', 'text 5'];

        mockEmbedContent
          .mockResolvedValueOnce({
            embeddings: [
              { values: createDummyVector() },
              { values: createDummyVector() },
            ],
          })
          .mockResolvedValueOnce({
            embeddings: [
              { values: createDummyVector() },
              { values: createDummyVector() },
            ],
          })
          .mockResolvedValueOnce({
            embeddings: [{ values: createDummyVector() }],
          });

        const result = await provider.embedDocuments(texts);

        expect(result).toHaveLength(5);
        expect(mockEmbedContent).toHaveBeenCalledTimes(3);

        // Verify batch 1 call
        expect(mockEmbedContent).toHaveBeenNthCalledWith(1, {
          model: 'gemini-embedding-001',
          contents: ['text 1', 'text 2'],
          config: {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EXPECTED_DIMENSIONS,
          },
        });

        // Verify batch 3 call (remaining 1 item)
        expect(mockEmbedContent).toHaveBeenNthCalledWith(3, {
          model: 'gemini-embedding-001',
          contents: ['text 5'],
          config: {
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EXPECTED_DIMENSIONS,
          },
        });
      })();
    });

    it('should return empty array when texts array is empty', async () => {
      const result = await provider.embedDocuments([]);
      expect(result).toEqual([]);
      expect(mockEmbedContent).not.toHaveBeenCalled();
    });
  });

  describe('retry on 429 and 5xx errors', () => {
    it('should retry on 429 rate limit error and succeed when next attempt works', async () => {
      const error429 = {
        status: 429,
        message: 'Resource exhausted: rate limit exceeded',
      };

      mockEmbedContent.mockRejectedValueOnce(error429).mockResolvedValueOnce({
        embeddings: [{ values: createDummyVector() }],
      });

      const result = await provider.embedDocuments(['single text']);

      expect(result).toHaveLength(1);
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    });

    it('should retry on 503 transient error and succeed', async () => {
      const error503 = { status: 503, message: 'Service Unavailable' };

      mockEmbedContent.mockRejectedValueOnce(error503).mockResolvedValueOnce({
        embeddings: [{ values: createDummyVector() }],
      });

      const result = await provider.embedDocuments(['single text']);

      expect(result).toHaveLength(1);
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    });

    it('should fail after max 5 attempts when 429 persists', async () => {
      const error429 = { status: 429, message: 'Resource exhausted' };
      mockEmbedContent.mockRejectedValue(error429);

      await expect(provider.embedDocuments(['failing text'])).rejects.toEqual(
        error429,
      );
      expect(mockEmbedContent).toHaveBeenCalledTimes(5);
    }, 15000);

    it('should NOT retry non-transient 400 Bad Request error', async () => {
      const error400 = { status: 400, message: 'Invalid argument provided' };
      mockEmbedContent.mockRejectedValueOnce(error400);

      await expect(provider.embedDocuments(['bad text'])).rejects.toEqual(
        error400,
      );
      expect(mockEmbedContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('dimension validation', () => {
    it('should throw an error if an embedding vector has wrong dimension', async () => {
      const wrongDimensionVector = createDummyVector(768); // 768 instead of 1536

      mockEmbedContent.mockResolvedValueOnce({
        embeddings: [{ values: wrongDimensionVector }],
      });

      await expect(
        provider.embedDocuments(['text with wrong dim']),
      ).rejects.toThrow(
        /Embedding vector dimension mismatch.*expected 1536, got 768/,
      );
    });
  });

  describe('embedQuery', () => {
    it('should embed query with RETRIEVAL_QUERY taskType and validate dimensions', async () => {
      const queryVector = createDummyVector(EXPECTED_DIMENSIONS);
      mockEmbedContent.mockResolvedValueOnce({
        embeddings: [{ values: queryVector }],
      });

      const result = await provider.embedQuery('search for docs');

      expect(result).toEqual(queryVector);
      expect(mockEmbedContent).toHaveBeenCalledWith({
        model: 'gemini-embedding-001',
        contents: ['search for docs'],
        config: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: EXPECTED_DIMENSIONS,
        },
      });
    });

    it('should throw if query embedding dimension is incorrect', async () => {
      mockEmbedContent.mockResolvedValueOnce({
        embeddings: [{ values: createDummyVector(512) }],
      });

      await expect(provider.embedQuery('invalid dim query')).rejects.toThrow(
        /Embedding vector dimension mismatch for query: expected 1536, got 512/,
      );
    });
  });
});
