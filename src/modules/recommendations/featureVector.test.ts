import { buildUserVector, computePopulationStats, encodeOneHot, zScore } from './featureVector';
import { FEATURE_DEFINITIONS } from './featureRegistry';

describe('encodeOneHot', () => {
  it('sets a single 1 for a matching value', () => {
    expect(encodeOneHot('medium', ['low', 'medium', 'high'])).toEqual([0, 1, 0]);
  });

  it('encodes an unknown value as all-zero (unknown-value fallback)', () => {
    expect(encodeOneHot('extreme', ['low', 'medium', 'high'])).toEqual([0, 0, 0]);
  });

  it('encodes a null/undefined value as all-zero', () => {
    expect(encodeOneHot(null, ['low', 'medium', 'high'])).toEqual([0, 0, 0]);
    expect(encodeOneHot(undefined, ['low', 'medium', 'high'])).toEqual([0, 0, 0]);
  });
});

describe('zScore', () => {
  it('computes a standard z-score', () => {
    expect(zScore(15, { mean: 10, stddev: 5 })).toBeCloseTo(1);
  });

  it('returns 0 for a zero-variance population instead of dividing by zero', () => {
    expect(zScore(10, { mean: 10, stddev: 0 })).toBe(0);
    expect(zScore(999, { mean: 10, stddev: 0 })).toBe(0);
  });
});

describe('computePopulationStats', () => {
  it('computes mean and stddev per feature', () => {
    const stats = computePopulationStats([{ x: 2 }, { x: 4 }, { x: 6 }], ['x']);
    expect(stats.x.mean).toBeCloseTo(4);
    expect(stats.x.stddev).toBeCloseTo(Math.sqrt(((2 - 4) ** 2 + (4 - 4) ** 2 + (6 - 4) ** 2) / 3));
  });

  it('handles a population of one without dividing by zero', () => {
    const stats = computePopulationStats([{ x: 42 }], ['x']);
    expect(stats.x.mean).toBe(42);
    expect(stats.x.stddev).toBe(0);
  });

  it('defaults missing values to 0', () => {
    const stats = computePopulationStats([{ x: 1 }, {}], ['x']);
    expect(stats.x.mean).toBeCloseTo(0.5);
  });
});

describe('buildUserVector', () => {
  it('produces null behavioral for a cold-start user', () => {
    const vector = buildUserVector({ pref_budget_level: 'medium' }, null, {}, []);
    expect(vector.behavioral).toBeNull();
  });

  it('produces a weighted, z-scored behavioral vector for a warm user', () => {
    const stats = { 'category_share:restaurant': { mean: 0.5, stddev: 0.5 } };
    const vector = buildUserVector({}, { 'category_share:restaurant': 1 }, stats, ['log-1']);
    expect(vector.behavioral).not.toBeNull();
    expect(vector.topRankedPlaceIds).toEqual(['log-1']);
  });

  it('vector length matches the number of registry dimensions (extensibility invariant)', () => {
    const explicitCount = FEATURE_DEFINITIONS.filter((f) => f.source === 'explicit').reduce(
      (sum, f) => sum + (f.values?.length ?? 0),
      0,
    );
    const behavioralCount = FEATURE_DEFINITIONS.filter((f) => f.source === 'behavioral').length;

    const vector = buildUserVector({}, {}, {}, []);
    expect(vector.explicit).toHaveLength(explicitCount);
    expect(vector.behavioral).toHaveLength(behavioralCount);

    // Adding a dummy feature definition changes vector length with zero
    // changes to the vector-building or scoring code -- this is the test
    // that actually enforces the design's core promise.
    FEATURE_DEFINITIONS.push({
      name: 'dummy_test_feature',
      source: 'behavioral',
      type: 'continuous',
      encoding: 'zscore',
      weight: 1,
    });
    try {
      const widened = buildUserVector({}, {}, {}, []);
      expect(widened.behavioral).toHaveLength(behavioralCount + 1);
    } finally {
      FEATURE_DEFINITIONS.pop();
    }
  });
});
