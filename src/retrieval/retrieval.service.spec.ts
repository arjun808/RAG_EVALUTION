import { Test, TestingModule } from '@nestjs/testing';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { EMBEDDING_PROVIDER } from '../embedding/embedding-provider.interface';
import type { EmbeddingProvider } from '../embedding/embedding-provider.interface';
import { RetrievalService } from './retrieval.service';

describe('RetrievalService', () => {
  let service: RetrievalService;
  let mockEmbeddingProvider: Partial<EmbeddingProvider>;
  let mockSequelize: { query: jest.Mock };

  beforeEach(async () => {
    mockEmbeddingProvider = {
      embedQuery: jest.fn().mockResolvedValue([0.1, 0.25, -0.5, 0.77777]),
    };

    mockSequelize = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        {
          provide: EMBEDDING_PROVIDER,
          useValue: mockEmbeddingProvider,
        },
        {
          provide: Sequelize,
          useValue: mockSequelize,
        },
      ],
    }).compile();

    service = module.get<RetrievalService>(RetrievalService);
  });

  describe('search', () => {
    const mockDbRows = [
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        chunkIndex: 0,
        content: 'Content of chunk 1',
        title: 'Document 1',
        source: 'https://docs.example.com/1',
        score: 0.987654321,
      },
      {
        chunkId: 'chunk-2',
        documentId: 'doc-2',
        chunkIndex: 3,
        content: 'Content of chunk 2',
        title: 'Document 2',
        source: 'https://docs.example.com/2',
        score: '0.74123456', // Test string score parsing from pg driver
      },
      {
        chunkId: 'chunk-3',
        documentId: 'doc-3',
        chunkIndex: 1,
        content: 'Content of chunk 3',
        title: 'Document 3',
        source: null,
        score: 0.5,
      },
    ];

    it('should pass topK as the query limit parameter', async () => {
      mockSequelize.query.mockResolvedValueOnce([]);

      await service.search('what is RAG?', 12);

      expect(mockSequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        expect.objectContaining({
          bind: [expect.any(String), 12],
          type: QueryTypes.SELECT,
        }),
      );
    });

    it('should format the vector literal as [a,b,c] with bind parameters', async () => {
      mockSequelize.query.mockResolvedValueOnce([]);

      await service.search('find relevant info', 5);

      expect(mockEmbeddingProvider.embedQuery).toHaveBeenCalledWith(
        'find relevant info',
      );

      expect(mockSequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        expect.objectContaining({
          bind: [
            expect.stringMatching(
              /^\[(-?\d+(\.\d+)?)(,-?\d+(\.\d+)?)*\]$/,
            ) as string,
            5,
          ],
          type: QueryTypes.SELECT,
        }),
      );

      const queryCalls = mockSequelize.query.mock.calls as unknown as [
        string,
        { bind: [string, number] },
      ][];
      expect(queryCalls).toHaveLength(1);

      const options = queryCalls[0][1];
      const vectorLiteral = options.bind[0];

      // Verify exact literal string format
      expect(vectorLiteral).toBe('[0.1,0.25,-0.5,0.77777]');
    });

    it('should round scores to 4 decimal places', async () => {
      mockSequelize.query.mockResolvedValueOnce(mockDbRows);

      const results = await service.search('test query', 5);

      expect(results).toHaveLength(3);
      // 0.987654321 -> 0.9877
      expect(results[0].score).toBe(0.9877);
      // 0.74123456 -> 0.7412
      expect(results[1].score).toBe(0.7412);
      // 0.5 -> 0.5
      expect(results[2].score).toBe(0.5);
    });

    it('should return results in the exact order the query returned them', async () => {
      mockSequelize.query.mockResolvedValueOnce(mockDbRows);

      const results = await service.search('ordered query', 5);

      expect(results.map((r) => r.chunkId)).toEqual([
        'chunk-1',
        'chunk-2',
        'chunk-3',
      ]);
      expect(results.map((r) => r.documentId)).toEqual([
        'doc-1',
        'doc-2',
        'doc-3',
      ]);
      expect(results.map((r) => r.chunkIndex)).toEqual([0, 3, 1]);
      expect(results[0].title).toBe('Document 1');
      expect(results[1].source).toBe('https://docs.example.com/2');
      expect(results[2].source).toBeNull();
    });

    it('should return an empty array if database returns no matching rows', async () => {
      mockSequelize.query.mockResolvedValueOnce([]);

      const results = await service.search('empty query', 5);

      expect(results).toEqual([]);
    });
  });
});
