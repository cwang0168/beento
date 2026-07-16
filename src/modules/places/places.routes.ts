import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { canView } from '../permissions/permissions.service';
import { categoryEnum } from '../../shared/categories';
import { haversineDistanceKm } from './places.service';

const createPlaceSchema = z.object({
  name: z.string().min(1),
  category: categoryEnum,
  lat: z.number(),
  lng: z.number(),
});

export const placesRouter = Router();

// Shared by the FR-4 capture picker and the FR-29 trip planner search.
placesRouter.get('/search', requireAuth, async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const categoryParam = typeof req.query.category === 'string' ? req.query.category : undefined;
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
  const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;

  if (categoryParam && !categoryEnum.safeParse(categoryParam).success) {
    res.status(400).json({ error: 'Invalid category' });
    return;
  }
  const category = categoryParam as z.infer<typeof categoryEnum> | undefined;

  const places = await prisma.place.findMany({
    where: {
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(category ? { category } : {}),
    },
    take: 50,
  });

  const hasOrigin = lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng);
  const ranked = hasOrigin
    ? places
        .map((place) => ({
          place,
          distanceKm: haversineDistanceKm({ lat: lat as number, lng: lng as number }, place),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
    : places.map((place) => ({ place, distanceKm: undefined }));

  const topResults = ranked.slice(0, 20);

  // FR-32: social proof from the viewer's own accepted connections only --
  // no cross-user disclosure risk, since an accepted connection's content
  // is already fully visible per NFR-4f.
  const userId = req.userId!;
  const connections = await prisma.connection.findMany({
    where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
  });
  const connectionIds = connections.map((c) => (c.requesterId === userId ? c.addresseeId : c.requesterId));
  const placeIds = topResults.map(({ place }) => place.id);

  const [connLogs, connSaves] = await Promise.all([
    prisma.log.findMany({
      where: { userId: { in: connectionIds }, placeId: { in: placeIds }, rankPosition: { not: null } },
    }),
    prisma.save.findMany({ where: { userId: { in: connectionIds }, placeId: { in: placeIds } } }),
  ]);
  const activityByPlace = new Map<string, Array<{ user_id: string; type: 'log' | 'save'; rank_position?: number }>>();
  for (const log of connLogs) {
    const list = activityByPlace.get(log.placeId) ?? [];
    list.push({ user_id: log.userId, type: 'log', rank_position: log.rankPosition ?? undefined });
    activityByPlace.set(log.placeId, list);
  }
  for (const save of connSaves) {
    const list = activityByPlace.get(save.placeId) ?? [];
    list.push({ user_id: save.userId, type: 'save' });
    activityByPlace.set(save.placeId, list);
  }

  // Stable sort: results with connection activity float above equally
  // relevant results without it, but relative order within each group
  // (distance/insertion order) is preserved.
  const withActivity = topResults.map(({ place, distanceKm }) => ({
    place,
    distanceKm,
    activity: activityByPlace.get(place.id) ?? [],
  }));
  withActivity.sort((a, b) => (b.activity.length > 0 ? 1 : 0) - (a.activity.length > 0 ? 1 : 0));

  res.json(
    withActivity.map(({ place, distanceKm, activity }) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      lat: place.lat,
      lng: place.lng,
      source: place.source,
      distance_km: distanceKm,
      connection_activity: activity,
    })),
  );
});

// FR-12: for a given place, which of the viewer's connections have visited
// it and how they ranked it. Filtered per-visitor by canView, not gated
// once for the whole place -- a place can show 3 connections and hide 40
// other logs from private non-connections.
placesRouter.get('/:id/visitors', requireAuth, async (req: AuthedRequest, res) => {
  const place = await prisma.place.findUnique({ where: { id: req.params.id } });
  if (!place) {
    res.status(404).json({ error: 'Place not found' });
    return;
  }
  const viewerId = req.userId!;
  const logs = await prisma.log.findMany({
    where: { placeId: place.id, rankPosition: { not: null } },
    include: { user: true },
  });

  const visible = [];
  for (const log of logs) {
    if (await canView(viewerId, log.userId, 'past_content')) {
      visible.push({
        user: { id: log.user.id, display_name: log.user.displayName, username: log.user.username },
        rank_position: log.rankPosition,
      });
    }
  }
  res.json(visible);
});

placesRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createPlaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const place = await prisma.place.create({
    data: {
      ...parsed.data,
      source: 'user_created',
      createdById: req.userId,
    },
  });
  res.status(201).json(place);
});

placesRouter.get('/:id', requireAuth, async (req, res) => {
  const place = await prisma.place.findUnique({ where: { id: req.params.id } });
  if (!place) {
    res.status(404).json({ error: 'Place not found' });
    return;
  }
  res.json(place);
});
