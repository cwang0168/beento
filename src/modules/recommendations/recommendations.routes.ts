import { Router } from 'express';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { runSimilarityBatch } from './similarityBatch';

export const recommendationsRouter = Router();

const TOP_N_SIMILAR_USERS = 20;
const MAX_RECOMMENDATIONS = 20;

// FR-20: places the viewer hasn't logged, drawn from their public-profile
// similarity cohort. Minimum cohort size is 1 -- never gated on N>=2.
recommendationsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;

  const similar = await prisma.userSimilarityCache.findMany({
    where: { userId },
    orderBy: { score: 'desc' },
    take: TOP_N_SIMILAR_USERS,
  });
  if (similar.length === 0) {
    res.json({ recommendations: [], reason: 'no_cohort_yet' });
    return;
  }
  const similarUserIds = similar.map((s) => s.similarUserId);

  const [theirTopRankedLogs, myLogs] = await Promise.all([
    prisma.log.findMany({
      where: { userId: { in: similarUserIds }, rankPosition: { lte: 3 } },
      include: { place: true },
    }),
    prisma.log.findMany({ where: { userId } }),
  ]);
  const myLoggedPlaceIds = new Set(myLogs.map((log) => log.placeId));

  const byPlace = new Map<string, { place: (typeof theirTopRankedLogs)[number]['place']; cohort: Set<string> }>();
  for (const log of theirTopRankedLogs) {
    if (myLoggedPlaceIds.has(log.placeId)) {
      continue;
    }
    const entry = byPlace.get(log.placeId) ?? { place: log.place, cohort: new Set<string>() };
    entry.cohort.add(log.userId);
    byPlace.set(log.placeId, entry);
  }

  const recommendations = [...byPlace.values()].slice(0, MAX_RECOMMENDATIONS).map(({ place, cohort }) => ({
    place: { id: place.id, name: place.name, category: place.category, lat: place.lat, lng: place.lng },
    cohort_size: cohort.size,
  }));

  res.json({ recommendations });
});

// Internal/cron-triggered -- recomputes the whole similarity cache. Not
// part of the mobile-facing API surface (no requireAuth), same pattern as
// the Phase 2 post-trip notify endpoint.
recommendationsRouter.post('/refresh', async (_req, res) => {
  await runSimilarityBatch();
  res.status(204).send();
});
