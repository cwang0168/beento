import { prisma } from '../../prisma';
import { MACRO_REGIONS, macroRegionFor } from './macroRegion';

const PLACE_CATEGORIES = ['restaurant', 'hotel', 'bar', 'activity'] as const;
const COLD_START_LOG_THRESHOLD = 3;

export interface UserBehavioralData {
  // null = cold start (fewer than 3 Logs) -- caller collapses to
  // explicit-only comparison rather than zero-imputing.
  raw: Record<string, number> | null;
  topRankedPlaceIds: string[];
}

export async function computeUserBehavioralData(userId: string): Promise<UserBehavioralData> {
  const logs = await prisma.log.findMany({
    where: { userId, rankPosition: { not: null } },
    include: { place: true },
  });

  if (logs.length < COLD_START_LOG_THRESHOLD) {
    return { raw: null, topRankedPlaceIds: [] };
  }

  const raw: Record<string, number> = {};

  for (const category of PLACE_CATEGORIES) {
    const inCategory = logs.filter((log) => log.place.category === category);
    raw[`category_share:${category}`] = inCategory.length / logs.length;

    if (inCategory.length === 0) {
      raw[`category_avg_rank_percentile:${category}`] = 0;
    } else {
      const percentiles = inCategory.map((log) => {
        const count = inCategory.length;
        return count === 1 ? 1 : 1 - (log.rankPosition! - 1) / (count - 1);
      });
      raw[`category_avg_rank_percentile:${category}`] = percentiles.reduce((sum, p) => sum + p, 0) / percentiles.length;
    }
  }

  const regionCounts = new Map<string, number>();
  for (const log of logs) {
    const region = macroRegionFor(log.place.lat, log.place.lng);
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
  }
  for (const region of MACRO_REGIONS) {
    raw[`region_share:${region}`] = (regionCounts.get(region) ?? 0) / logs.length;
  }

  const topRankedPlaceIds: string[] = [];
  for (const category of PLACE_CATEGORIES) {
    const inCategory = logs
      .filter((log) => log.place.category === category)
      .sort((a, b) => a.rankPosition! - b.rankPosition!);
    topRankedPlaceIds.push(...inCategory.slice(0, 3).map((log) => log.placeId));
  }

  return { raw, topRankedPlaceIds };
}
