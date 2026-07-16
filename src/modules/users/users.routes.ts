import { Router } from 'express';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { canView } from '../permissions/permissions.service';
import { categoryEnum } from '../../shared/categories';

export const usersRouter = Router();

// NFR-4a: below the permission threshold, still 200 with an identity-only
// payload -- a private profile is a valid search result, just a minimal one.
usersRouter.get('/:id/profile', requireAuth, async (req: AuthedRequest, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const allowed = await canView(req.userId!, target.id, 'past_content');
  if (!allowed) {
    res.json({ id: target.id, name: target.displayName, username: target.username });
    return;
  }

  const [placeCount, tripCount] = await Promise.all([
    prisma.log.count({ where: { userId: target.id, rankPosition: { not: null } } }),
    prisma.trip.count({ where: { ownerId: target.id, endDate: { lt: new Date() } } }),
  ]);
  res.json({
    id: target.id,
    name: target.displayName,
    username: target.username,
    place_count: placeCount,
    completed_trip_count: tripCount,
  });
});

// FR-11: view a connected friend's ranked places.
usersRouter.get('/:id/logs', requireAuth, async (req: AuthedRequest, res) => {
  const targetId = req.params.id;
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const allowed = await canView(req.userId!, targetId, 'past_content');
  if (!allowed) {
    res.status(403).json({ error: 'Not permitted' });
    return;
  }

  const categoryParam = typeof req.query.category === 'string' ? req.query.category : undefined;
  if (categoryParam && !categoryEnum.safeParse(categoryParam).success) {
    res.status(400).json({ error: 'Invalid category' });
    return;
  }

  const logs = await prisma.log.findMany({
    where: {
      userId: targetId,
      rankPosition: { not: null },
      ...(categoryParam ? { place: { category: categoryParam as ReturnType<typeof categoryEnum.parse> } } : {}),
    },
    orderBy: { rankPosition: 'asc' },
    include: { place: true },
  });

  res.json(
    logs.map((log) => ({
      id: log.id,
      place: { id: log.place.id, name: log.place.name, category: log.place.category, lat: log.place.lat, lng: log.place.lng },
      rank_position: log.rankPosition,
    })),
  );
});
