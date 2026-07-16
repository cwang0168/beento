// Pure, Prisma-free so the boundary (20th vs 21st request) is unit
// testable in isolation, same pattern as the ranking algorithm.

export interface RateLimitState {
  windowStart: Date;
  requestCount: number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

export type RateLimitDecision =
  | { allowed: true; nextState: RateLimitState }
  | { allowed: false; retryAfterMs: number };

export function evaluateRateLimit(state: RateLimitState | null, now: Date): RateLimitDecision {
  if (!state || now.getTime() - state.windowStart.getTime() >= WINDOW_MS) {
    return { allowed: true, nextState: { windowStart: now, requestCount: 1 } };
  }
  if (state.requestCount < MAX_REQUESTS_PER_WINDOW) {
    return { allowed: true, nextState: { windowStart: state.windowStart, requestCount: state.requestCount + 1 } };
  }
  return { allowed: false, retryAfterMs: WINDOW_MS - (now.getTime() - state.windowStart.getTime()) };
}
