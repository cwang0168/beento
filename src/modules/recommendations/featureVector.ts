import { FEATURE_DEFINITIONS } from './featureRegistry';

export interface PopulationStat {
  mean: number;
  stddev: number;
}

export type PopulationStats = Record<string, PopulationStat>;

export interface UserVector {
  explicit: number[];
  // null = cold start (fewer than 3 Logs) -- caller collapses to
  // explicit-only comparison rather than zero-imputing.
  behavioral: number[] | null;
  topRankedPlaceIds: string[];
}

// Unknown-value fallback: a value outside the declared enum encodes as
// all-zero rather than throwing, so one user's stale data can't fail a
// whole batch run.
export function encodeOneHot(value: string | null | undefined, values: string[]): number[] {
  return values.map((allowed) => (value === allowed ? 1 : 0));
}

// Zero-variance guard: a population of one (or genuinely uniform) skips
// z-scoring for that dimension rather than dividing by zero.
export function zScore(value: number, stat: PopulationStat): number {
  if (stat.stddev === 0) {
    return 0;
  }
  return (value - stat.mean) / stat.stddev;
}

export function computePopulationStats(rows: Array<Record<string, number>>, featureNames: string[]): PopulationStats {
  const stats: PopulationStats = {};
  const n = rows.length || 1;
  for (const name of featureNames) {
    const values = rows.map((row) => row[name] ?? 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    stats[name] = { mean, stddev: Math.sqrt(variance) };
  }
  return stats;
}

export function buildUserVector(
  explicitValues: Record<string, string | null | undefined>,
  behavioralRaw: Record<string, number> | null,
  populationStats: PopulationStats,
  topRankedPlaceIds: string[],
): UserVector {
  const explicit = FEATURE_DEFINITIONS.filter((f) => f.source === 'explicit').flatMap((def) =>
    encodeOneHot(explicitValues[def.name], def.values ?? []).map((v) => v * def.weight),
  );

  let behavioral: number[] | null = null;
  if (behavioralRaw !== null) {
    behavioral = FEATURE_DEFINITIONS.filter((f) => f.source === 'behavioral').map((def) => {
      const raw = behavioralRaw[def.name] ?? 0;
      const stat = populationStats[def.name] ?? { mean: 0, stddev: 0 };
      return zScore(raw, stat) * def.weight;
    });
  }

  return { explicit, behavioral, topRankedPlaceIds };
}
