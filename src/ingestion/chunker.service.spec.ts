import { Test, TestingModule } from '@nestjs/testing';
import { ChunkerService } from './chunker.service';

describe('ChunkerService', () => {
  let service: ChunkerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChunkerService],
    }).compile();

    service = module.get<ChunkerService>(ChunkerService);
  });

  describe('empty input', () => {
    it('should return empty array for empty string', () => {
      expect(service.chunk('', 100, 20)).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      expect(service.chunk('   \n\n\t   ', 100, 20)).toEqual([]);
    });
  });

  describe('validation errors', () => {
    it('should throw error when overlap is greater than or equal to chunkSize', () => {
      expect(() => service.chunk('Some text', 100, 100)).toThrow(
        'overlap must be less than chunkSize',
      );
      expect(() => service.chunk('Some text', 100, 150)).toThrow(
        'overlap must be less than chunkSize',
      );
    });

    it('should throw error when chunkSize is less than or equal to 0', () => {
      expect(() => service.chunk('Some text', 0, 0)).toThrow(
        'chunkSize must be greater than 0',
      );
      expect(() => service.chunk('Some text', -10, 0)).toThrow(
        'chunkSize must be greater than 0',
      );
    });

    it('should throw error when overlap is negative', () => {
      expect(() => service.chunk('Some text', 100, -5)).toThrow(
        'overlap must be non-negative',
      );
    });
  });

  describe('max size', () => {
    it('should return single chunk if text length <= chunkSize', () => {
      const text = 'Short text within limit.';
      const result = service.chunk(text, 100, 20);
      expect(result).toEqual([text]);
      expect(result[0].length).toBeLessThanOrEqual(100);
    });

    it('should ensure every chunk is at most chunkSize characters', () => {
      const paragraphs = [
        'Paragraph one is here and it has quite a bit of interesting content for testing.',
        'Paragraph two follows with additional information and details on the topic.',
        'Paragraph three concludes the discussion with final remarks and insights.',
      ];
      const text = paragraphs.join('\n\n');
      const chunkSize = 80;
      const overlap = 20;

      const chunks = service.chunk(text, chunkSize, overlap);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(chunkSize);
      }
    });

    it('should hard-cut unbroken strings that exceed chunkSize', () => {
      const unbrokenText = 'A'.repeat(250);
      const chunkSize = 50;
      const overlap = 10;

      const chunks = service.chunk(unbrokenText, chunkSize, overlap);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(chunkSize);
      }
    });
  });

  describe('overlap', () => {
    it('should produce overlapping content in consecutive chunks', () => {
      const sentences = [
        'The quick brown fox jumps over the lazy dog.',
        'Sphinx of black quartz, judge my vow.',
        'Pack my box with five dozen liquor jugs.',
        'How vexingly quick daft zebras jump.',
      ];
      const text = sentences.join(' ');
      const chunkSize = 80;
      const overlap = 30;

      const chunks = service.chunk(text, chunkSize, overlap);

      expect(chunks.length).toBeGreaterThan(1);

      // Verify each consecutive pair shares content
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentChunk = chunks[i];
        const nextChunk = chunks[i + 1];

        // The end of currentChunk should appear in the beginning of nextChunk
        const currentWords = currentChunk.split(/\s+/).filter(Boolean);
        const nextWords = nextChunk.split(/\s+/).filter(Boolean);

        const lastWord = currentWords[currentWords.length - 1].replace(
          /[.,]/g,
          '',
        );
        const hasOverlap = nextWords.some(
          (w) => w.replace(/[.,]/g, '') === lastWord,
        );
        expect(hasOverlap).toBe(true);
      }
    });

    it('should handle zero overlap correctly', () => {
      const text =
        'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
      const chunks = service.chunk(text, 35, 0);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(35);
      }
    });
  });

  describe('trimming and empty chunks', () => {
    it('should trim all chunks and not produce empty chunks', () => {
      const text = '  \n\n  Hello world.  \n\n  Another sentence here.  \n\n  ';
      const chunks = service.chunk(text, 30, 5);

      for (const chunk of chunks) {
        expect(chunk).toBe(chunk.trim());
        expect(chunk.length).toBeGreaterThan(0);
      }
    });
  });
});
