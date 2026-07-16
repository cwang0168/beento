import { evaluateRateLimit } from './rateLimiter';

describe('evaluateRateLimit', () => {
  const windowStart = new Date('2026-01-01T00:00:00Z');

  it('allows the first request with no prior state', () => {
    const decision = evaluateRateLimit(null, windowStart);
    expect(decision).toEqual({ allowed: true, nextState: { windowStart, requestCount: 1 } });
  });

  it('allows the 20th request within the window', () => {
    const now = new Date(windowStart.getTime() + 1000);
    const decision = evaluateRateLimit({ windowStart, requestCount: 19 }, now);
    expect(decision).toEqual({ allowed: true, nextState: { windowStart, requestCount: 20 } });
  });

  it('rejects the 21st request within the window', () => {
    const now = new Date(windowStart.getTime() + 1000);
    const decision = evaluateRateLimit({ windowStart, requestCount: 20 }, now);
    expect(decision.allowed).toBe(false);
  });

  it('resets the window once 24h have elapsed', () => {
    const now = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    const decision = evaluateRateLimit({ windowStart, requestCount: 20 }, now);
    expect(decision).toEqual({ allowed: true, nextState: { windowStart: now, requestCount: 1 } });
  });

  it('does not reset just under the 24h boundary', () => {
    const now = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const decision = evaluateRateLimit({ windowStart, requestCount: 20 }, now);
    expect(decision.allowed).toBe(false);
  });
});
