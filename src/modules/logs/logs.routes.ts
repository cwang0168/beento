import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { categoryEnum } from '../../shared/categories';
import { createLog, LogResult } from './logs.service';
import { applyComparison, midpointIndex } from './ranking';

export const logsRouter = Router();

export function serializeLog(log: LogResult) {
  return {
    id: log.id,
    place_id: log.placeId,
    rank_position: log.rankPosition,
    needs_ranking: log.rankPosition === null,
  };
}

// Create a Log; triggers the ranking flow (FR-3/FR-7).
logsRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ place_id: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { place_id: placeId } = parsed.data;

  const place = await prisma.place.findUnique({ where: { id: placeId } });
  if (!place) {
    res.status(404).json({ error: 'Place not found' });
    return;
  }

  const userId = req.userId!;
  // Duplicate Log on the same place+user is a no-op, not an error (NFR error handling).
  const alreadyExisted = await prisma.log.findUnique({ where: { placeId_userId: { placeId, userId } } });
  const log = await createLog(userId, placeId);
  res.status(alreadyExisted ? 200 : 201).json(serializeLog(log));
});

// Returns the current binary-insertion comparison target (FR-7).
logsRouter.get('/rank-candidates', requireAuth, async (req: AuthedRequest, res) => {
  const placeId = typeof req.query.place_id === 'string' ? req.query.place_id : undefined;
  if (!placeId) {
    res.status(400).json({ error: 'place_id is required' });
    return;
  }
  const userId = req.userId!;

  const log = await prisma.log.findUnique({ where: { placeId_userId: { placeId, userId } } });
  if (!log || log.rankPosition !== null || log.rankLow === null || log.rankHigh === null) {
    res.status(400).json({ error: 'No ranking in progress for this place' });
    return;
  }

  const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
  const resolvedLogs = await prisma.log.findMany({
    where: { userId, rankPosition: { not: null }, place: { category: place.category } },
    orderBy: { rankPosition: 'asc' },
    include: { place: true },
  });

  const mid = midpointIndex({ low: log.rankLow, high: log.rankHigh });
  const candidate = resolvedLogs[mid];
  if (!candidate) {
    res.status(500).json({ error: 'Ranking state inconsistent' });
    return;
  }

  res.json({
    candidate_log_id: candidate.id,
    candidate_place: {
      id: candidate.place.id,
      name: candidate.place.name,
      category: candidate.place.category,
    },
  });
});

// Records one pairwise comparison result (FR-7).
logsRouter.post('/:id/rank', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ won_against_log_id: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const userId = req.userId!;
  const { won_against_log_id: otherId } = parsed.data;

  const [logA, logB] = await Promise.all([
    prisma.log.findUnique({ where: { id: req.params.id } }),
    prisma.log.findUnique({ where: { id: otherId } }),
  ]);

  if (!logA || !logB || logA.userId !== userId || logB.userId !== userId) {
    res.status(404).json({ error: 'Log not found' });
    return;
  }

  const inProgress = logA.rankPosition === null ? logA : logB.rankPosition === null ? logB : null;
  const candidate = inProgress?.id === logA.id ? logB : logA;

  if (!inProgress || candidate.rankPosition === null) {
    res.status(400).json({ error: 'Invalid ranking comparison' });
    return;
  }
  if (inProgress.rankLow === null || inProgress.rankHigh === null) {
    res.status(400).json({ error: 'No ranking in progress for this log' });
    return;
  }

  const newLogWon = inProgress.id === req.params.id;
  const candidateIndex = candidate.rankPosition - 1;
  const outcome = applyComparison(
    { low: inProgress.rankLow, high: inProgress.rankHigh },
    candidateIndex,
    newLogWon,
  );

  if (outcome.resolved) {
    const finalPosition = outcome.insertionIndex + 1;
    const place = await prisma.place.findUniqueOrThrow({ where: { id: inProgress.placeId } });

    await prisma.$transaction([
      prisma.log.updateMany({
        where: {
          userId,
          rankPosition: { gte: finalPosition },
          place: { category: place.category },
          NOT: { id: inProgress.id },
        },
        data: { rankPosition: { increment: 1 } },
      }),
      prisma.log.update({
        where: { id: inProgress.id },
        data: { rankPosition: finalPosition, rankLow: null, rankHigh: null },
      }),
    ]);

    res.json({ id: inProgress.id, rank_position: finalPosition, needs_ranking: false });
    return;
  }

  const updated = await prisma.log.update({
    where: { id: inProgress.id },
    data: { rankLow: outcome.bounds.low, rankHigh: outcome.bounds.high },
  });
  res.json(serializeLog(updated));
});

// Ranked list per category (FR-8).
logsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const categoryParam = typeof req.query.category === 'string' ? req.query.category : undefined;
  if (categoryParam && !categoryEnum.safeParse(categoryParam).success) {
    res.status(400).json({ error: 'Invalid category' });
    return;
  }
  const category = categoryParam as z.infer<typeof categoryEnum> | undefined;

  const logs = await prisma.log.findMany({
    where: {
      userId: req.userId,
      rankPosition: { not: null },
      ...(category ? { place: { category } } : {}),
    },
    orderBy: { rankPosition: 'asc' },
    include: { place: true },
  });

  res.json(
    logs.map((log) => ({
      id: log.id,
      place: {
        id: log.place.id,
        name: log.place.name,
        category: log.place.category,
        lat: log.place.lat,
        lng: log.place.lng,
      },
      rank_position: log.rankPosition,
      logged_at: log.loggedAt,
    })),
  );
});
