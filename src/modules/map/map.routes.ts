import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { categoryEnum } from '../../shared/categories';
import { clusterPlaces } from './map.service';

export const mapRouter = Router();

const STATUS_VALUES = ['visited', 'want_to_go'] as const;

// FR-15/16/17/18/19/26/27: unified spatial view backing endpoint. Phase 1
// only supports owner=mine -- connection-scoped filters activate in Phase 2.
mapRouter.get('/places', requireAuth, async (req: AuthedRequest, res) => {
  const bboxParam = typeof req.query.bbox === 'string' ? req.query.bbox : undefined;
  if (!bboxParam) {
    res.status(400).json({ error: 'bbox is required' });
    return;
  }
  const parts = bboxParam.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    res.status(400).json({ error: 'bbox must be minLat,minLng,maxLat,maxLng' });
    return;
  }
  const [minLat, minLng, maxLat, maxLng] = parts;

  const categoryParam = typeof req.query.category === 'string' ? req.query.category : undefined;
  if (categoryParam && !categoryEnum.safeParse(categoryParam).success) {
    res.status(400).json({ error: 'Invalid category' });
    return;
  }

  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  if (ownerParam && ownerParam !== 'mine') {
    res.status(400).json({ error: "owner only supports 'mine' in this phase" });
    return;
  }

  const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (statusParam && !(STATUS_VALUES as readonly string[]).includes(statusParam)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const places = await prisma.place.findMany({
    where: {
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
      ...(categoryParam ? { category: categoryParam as z.infer<typeof categoryEnum> } : {}),
    },
  });

  const userId = req.userId!;
  const placeIds = places.map((place) => place.id);
  const [logs, saves] = await Promise.all([
    prisma.log.findMany({ where: { userId, placeId: { in: placeIds } } }),
    prisma.save.findMany({ where: { userId, placeId: { in: placeIds } } }),
  ]);
  const loggedPlaceIds = new Set(logs.map((log) => log.placeId));
  const savedPlaceIds = new Set(saves.map((save) => save.placeId));

  const withStatus = places.map((place) => ({
    ...place,
    status: loggedPlaceIds.has(place.id) ? 'visited' : savedPlaceIds.has(place.id) ? 'want_to_go' : 'none',
  }));
  const filtered = statusParam ? withStatus.filter((place) => place.status === statusParam) : withStatus;

  const clustered = clusterPlaces(filtered, { minLat, minLng, maxLat, maxLng });

  res.json(
    clustered.map((entry) =>
      entry.type === 'cluster'
        ? { type: 'cluster', lat: entry.lat, lng: entry.lng, count: entry.count }
        : {
            type: 'place',
            id: entry.place.id,
            name: entry.place.name,
            category: entry.place.category,
            lat: entry.place.lat,
            lng: entry.place.lng,
            status: entry.place.status,
          },
    ),
  );
});
