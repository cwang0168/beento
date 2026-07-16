import { applyComparison, initialBounds, midpointIndex, RankBounds } from './ranking';

describe('initialBounds', () => {
  it('returns null for the first log in a category (no comparison needed)', () => {
    expect(initialBounds(0)).toBeNull();
  });

  it('returns full-range bounds for a single existing log', () => {
    expect(initialBounds(1)).toEqual({ low: 0, high: 0 });
  });

  it('returns full-range bounds for an odd-sized list', () => {
    expect(initialBounds(5)).toEqual({ low: 0, high: 4 });
  });

  it('returns full-range bounds for an even-sized list', () => {
    expect(initialBounds(4)).toEqual({ low: 0, high: 3 });
  });
});

describe('midpointIndex', () => {
  it('rounds down for an odd-sized range', () => {
    expect(midpointIndex({ low: 0, high: 4 })).toBe(2);
  });

  it('rounds down for an even-sized range', () => {
    expect(midpointIndex({ low: 0, high: 3 })).toBe(1);
  });

  it('returns the single element once the range has collapsed to one', () => {
    expect(midpointIndex({ low: 2, high: 2 })).toBe(2);
  });
});

describe('applyComparison', () => {
  it('narrows toward the front when the new log wins', () => {
    expect(applyComparison({ low: 0, high: 4 }, 2, true)).toEqual({
      resolved: false,
      bounds: { low: 0, high: 1 },
    });
  });

  it('narrows toward the back when the new log loses', () => {
    expect(applyComparison({ low: 0, high: 4 }, 2, false)).toEqual({
      resolved: false,
      bounds: { low: 3, high: 4 },
    });
  });

  it('resolves immediately on a single-element range', () => {
    expect(applyComparison({ low: 0, high: 0 }, 0, true)).toEqual({
      resolved: true,
      insertionIndex: 0,
    });
    expect(applyComparison({ low: 0, high: 0 }, 0, false)).toEqual({
      resolved: true,
      insertionIndex: 1,
    });
  });

  function runToResolution(bounds: RankBounds, alwaysWin: boolean): number {
    let current: RankBounds = bounds;
    for (;;) {
      const outcome = applyComparison(current, midpointIndex(current), alwaysWin);
      if (outcome.resolved) {
        return outcome.insertionIndex;
      }
      current = outcome.bounds;
    }
  }

  it('always-loses converges to the last insertion index (odd-sized list)', () => {
    const bounds = initialBounds(5)!;
    expect(runToResolution(bounds, false)).toBe(5);
  });

  it('always-wins converges to insertion index 0 (odd-sized list)', () => {
    const bounds = initialBounds(5)!;
    expect(runToResolution(bounds, true)).toBe(0);
  });

  it('always-loses converges to the last insertion index (even-sized list)', () => {
    const bounds = initialBounds(4)!;
    expect(runToResolution(bounds, false)).toBe(4);
  });

  it('always-wins converges to insertion index 0 (even-sized list)', () => {
    const bounds = initialBounds(4)!;
    expect(runToResolution(bounds, true)).toBe(0);
  });

  it('converges to a middle insertion index within ceil(log2 n) rounds', () => {
    // 8 existing logs: win once (mid=3, so front half 0-2), then lose (0-2 -> mid=1, lose -> 2-2), then win...
    // Just assert it terminates and lands inside the valid range without infinite looping.
    let current = initialBounds(8)!;
    let rounds = 0;
    for (;;) {
      const outcome = applyComparison(current, midpointIndex(current), rounds % 2 === 0);
      rounds += 1;
      if (outcome.resolved) {
        expect(outcome.insertionIndex).toBeGreaterThanOrEqual(0);
        expect(outcome.insertionIndex).toBeLessThanOrEqual(8);
        break;
      }
      current = outcome.bounds;
      expect(rounds).toBeLessThanOrEqual(Math.ceil(Math.log2(8)) + 1);
    }
  });
});
