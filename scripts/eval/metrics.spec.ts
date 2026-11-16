import {
  average,
  hitAtK,
  isRelevant,
  normalize,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from './metrics';

describe('Metrics', () => {
  describe('normalize', () => {
    it('should lowercase, collapse whitespace, and trim', () => {
      const input = '  Hello   \t\n  BEAUTIFUL   \n\n World!  ';
      expect(normalize(input)).toBe('hello beautiful world!');
    });

    it('should handle empty or whitespace-only strings', () => {
      expect(normalize('')).toBe('');
      expect(normalize('   \t\n   ')).toBe('');
    });
  });

  describe('isRelevant', () => {
    const item = {
      expectedDocument: 'refund-policy',
      keyPhrase: 'within 30 days of delivery',
    };

    it('should return true when title matches and content contains keyPhrase', () => {
      const chunk = {
        title: 'refund-policy',
        content: 'Customers can return most items Within 30   DAYS of delivery for a refund.',
      };
      expect(isRelevant(chunk, item)).toBe(true);
    });

    it('should return false when title does not match', () => {
      const chunk = {
        title: 'shipping-policy',
        content: 'Customers can return items within 30 days of delivery.',
      };
      expect(isRelevant(chunk, item)).toBe(false);
    });

    it('should return false when keyPhrase is not in content', () => {
      const chunk = {
        title: 'refund-policy',
        content: 'All sales are final on clearance items.',
      };
      expect(isRelevant(chunk, item)).toBe(false);
    });

    it('should return false when expectedDocument or keyPhrase is null', () => {
      const chunk = {
        title: 'refund-policy',
        content: 'Some content',
      };
      expect(
        isRelevant(chunk, { expectedDocument: null, keyPhrase: null }),
      ).toBe(false);
    });
  });

  describe('ranking metrics - perfect retrieval', () => {
    // Rank 1 is relevant, totalRelevant = 1
    const results = [
      { isRelevant: true },
      { isRelevant: false },
      { isRelevant: false },
    ];
    const totalRelevant = 1;

    it('should compute hit, precision, recall and reciprocal rank', () => {
      expect(hitAtK(results, 1)).toBe(1);
      expect(hitAtK(results, 3)).toBe(1);

      expect(precisionAtK(results, 1)).toBe(1);
      expect(precisionAtK(results, 3)).toBeCloseTo(1 / 3, 4);

      expect(recallAtK(results, 1, totalRelevant)).toBe(1);
      expect(recallAtK(results, 3, totalRelevant)).toBe(1);

      expect(reciprocalRank(results)).toBe(1);
    });
  });

  describe('ranking metrics - a miss', () => {
    const results = [
      { isRelevant: false },
      { isRelevant: false },
      { isRelevant: false },
    ];
    const totalRelevant = 1;

    it('should return 0 for all metrics', () => {
      expect(hitAtK(results, 1)).toBe(0);
      expect(hitAtK(results, 3)).toBe(0);
      expect(precisionAtK(results, 1)).toBe(0);
      expect(precisionAtK(results, 3)).toBe(0);
      expect(recallAtK(results, 1, totalRelevant)).toBe(0);
      expect(recallAtK(results, 3, totalRelevant)).toBe(0);
      expect(reciprocalRank(results)).toBe(0);
    });
  });

  describe('ranking metrics - relevant chunk at rank 3', () => {
    const results = [
      { isRelevant: false },
      { isRelevant: false },
      { isRelevant: true },
      { isRelevant: false },
      { isRelevant: false },
    ];
    const totalRelevant = 1;

    it('should compute metrics reflecting relevance at rank 3', () => {
      expect(hitAtK(results, 1)).toBe(0);
      expect(hitAtK(results, 2)).toBe(0);
      expect(hitAtK(results, 3)).toBe(1);
      expect(hitAtK(results, 5)).toBe(1);

      expect(precisionAtK(results, 1)).toBe(0);
      expect(precisionAtK(results, 3)).toBeCloseTo(1 / 3, 4);
      expect(precisionAtK(results, 5)).toBeCloseTo(1 / 5, 4);

      expect(recallAtK(results, 1, totalRelevant)).toBe(0);
      expect(recallAtK(results, 2, totalRelevant)).toBe(0);
      expect(recallAtK(results, 3, totalRelevant)).toBe(1);

      expect(reciprocalRank(results)).toBeCloseTo(1 / 3, 4);
    });
  });

  describe('ranking metrics - totalRelevant = 2', () => {
    const results = [
      { isRelevant: true },
      { isRelevant: false },
      { isRelevant: true },
      { isRelevant: false },
    ];
    const totalRelevant = 2;

    it('should correctly calculate recall with totalRelevant = 2', () => {
      // At K = 1, only 1 of 2 relevant chunks is found
      expect(precisionAtK(results, 1)).toBe(1);
      expect(recallAtK(results, 1, totalRelevant)).toBe(0.5);

      // At K = 2, still 1 relevant chunk found
      expect(recallAtK(results, 2, totalRelevant)).toBe(0.5);

      // At K = 3, both relevant chunks found
      expect(precisionAtK(results, 3)).toBeCloseTo(2 / 3, 4);
      expect(recallAtK(results, 3, totalRelevant)).toBe(1.0);
    });
  });

  describe('average helper', () => {
    it('should compute average correctly', () => {
      expect(average([1, 2, 3, 4, 5])).toBe(3);
      expect(average([1, 0, 1])).toBeCloseTo(2 / 3, 4);
    });

    it('should return 0 for empty array', () => {
      expect(average([])).toBe(0);
    });
  });
});
