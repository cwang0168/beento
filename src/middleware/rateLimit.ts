import rateLimit, { Options } from 'express-rate-limit';

// Skipped under the test runner -- the existing integration suite makes far
// more than 30 auth requests inside a single test run, which isn't what
// these limiters exist to guard against. The mechanism itself is verified
// directly against a small-window instance in rateLimit.test.ts.
const skipInTests = () => process.env.NODE_ENV === 'test';

export function createRateLimiter(options: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTests,
    ...options,
  });
}

// General safety net beyond the FR-34-specific connection-request limiter.
// Generous enough not to bother a real mobile client's normal usage
// (map panning, search-as-you-type, etc.), just a backstop against abuse.
export const generalApiLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 600 });

// Tighter limit on auth specifically -- the endpoints most worth slowing
// down against credential stuffing / brute force.
export const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 30 });
