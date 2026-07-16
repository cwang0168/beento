// Binary-insertion pairwise ranking (FR-7). Pure and Prisma-free so it can
// be unit tested in isolation — the one nontrivial algorithm in Phase 1.

export interface RankBounds {
  low: number;
  high: number;
}

// Bounds are 0-indexed positions within the existing *resolved* logs for a
// category, excluding the log being ranked. `null` signals "no comparison
// needed" — the first log in a category skips straight to position 1.
export function initialBounds(existingResolvedCount: number): RankBounds | null {
  if (existingResolvedCount === 0) {
    return null;
  }
  return { low: 0, high: existingResolvedCount - 1 };
}

export function midpointIndex(bounds: RankBounds): number {
  return Math.floor((bounds.low + bounds.high) / 2);
}

export type ComparisonOutcome =
  | { resolved: true; insertionIndex: number }
  | { resolved: false; bounds: RankBounds };

// candidateIndex is the 0-indexed position of the log just compared against.
// newLogWon = true means the in-progress log was preferred (ranks better,
// i.e. a lower rank_position) than the candidate.
export function applyComparison(
  bounds: RankBounds,
  candidateIndex: number,
  newLogWon: boolean,
): ComparisonOutcome {
  const next: RankBounds = newLogWon
    ? { low: bounds.low, high: candidateIndex - 1 }
    : { low: candidateIndex + 1, high: bounds.high };

  if (next.low > next.high) {
    return { resolved: true, insertionIndex: next.low };
  }
  return { resolved: false, bounds: next };
}
