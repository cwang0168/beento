import { Router } from 'express';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';

export const libraryRouter = Router();

// Own Logs/Saves/Trips by name (FR-31). The required fallback path when the
// map can't be used, and the duplicate-log check at 200+ logs (NFR-6).
libraryRouter.get('/search', requireAuth, async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  if (!q) {
    res.status(400).json({ error: 'q is required' });
    return;
  }
  const userId = req.userId!;
  const nameFilter = { contains: q, mode: 'insensitive' as const };

  const [logs, saves, trips] = await Promise.all([
    prisma.log.findMany({ where: { userId, place: { name: nameFilter } }, include: { place: true } }),
    prisma.save.findMany({ where: { userId, place: { name: nameFilter } }, include: { place: true } }),
    prisma.trip.findMany({ where: { ownerId: userId, title: nameFilter } }),
  ]);

  res.json({
    logs: logs.map((log) => ({
      id: log.id,
      place: { id: log.place.id, name: log.place.name, category: log.place.category },
      rank_position: log.rankPosition,
    })),
    saves: saves.map((save) => ({
      id: save.id,
      place: { id: save.place.id, name: save.place.name, category: save.place.category },
    })),
    trips: trips.map((trip) => ({
      id: trip.id,
      title: trip.title,
      start_date: trip.startDate,
      end_date: trip.endDate,
    })),
  });
});
