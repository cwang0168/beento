import { cosineSimilarity, jaccardSimilarity, similarityScore } from './similarityScore';
import { UserVector } from './featureVector';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for a zero vector rather than NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('throws on mismatched lengths', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });
});

describe('jaccardSimilarity', () => {
  it('is 1 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('is 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a'], ['b'])).toBe(0);
  });

  it('computes partial overlap correctly', () => {
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
  });

  it('returns 0 for two empty sets rather than NaN', () => {
    expect(jaccardSimilarity([], [])).toBe(0);
  });
});

describe('similarityScore', () => {
  const warm = (explicit: number[], behavioral: number[], topRanked: string[]): UserVector => ({
    explicit,
    behavioral,
    topRankedPlaceIds: topRanked,
  });

  it('collapses to explicit-only cosine when either user is cold-start', () => {
    const a: UserVector = { explicit: [1, 0], behavioral: null, topRankedPlaceIds: [] };
    const b = warm([1, 0], [5, 5], ['p1']);
    expect(similarityScore(a, b)).toBeCloseTo(cosineSimilarity(a.explicit, b.explicit));
  });

  it('combines dense cosine and Jaccard overlap for two warm users', () => {
    const a = warm([1, 0], [1, 0], ['p1', 'p2']);
    const b = warm([1, 0], [1, 0], ['p1', 'p3']);
    const score = similarityScore(a, b);
    // identical dense vectors (score 1) + partial overlap (1/3)
    expect(score).toBeCloseTo(0.7 * 1 + 0.3 * (1 / 3));
  });

  it('is symmetric', () => {
    const a = warm([1, 0], [0.5, 0.5], ['p1']);
    const b = warm([0, 1], [0.2, 0.8], ['p1', 'p2']);
    expect(similarityScore(a, b)).toBeCloseTo(similarityScore(b, a));
  });
});
