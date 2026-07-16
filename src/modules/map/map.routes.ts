import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { canView } from '../permissions/permissions.service';
import { categoryEnum } from '../../shared/categories';
import { clusterPlaces } from './map.service';

export const mapRouter = Router();

const STATUS_VALUES = ['visited', 'want_to_go'] as const;

// Resolves the set of user IDs whose Logs/Saves should determine status,
// per the FR-17 owner filter. 'mine' (default) is viewer-only. 'everyone'
// is the viewer plus every connection they're permitted to see (FR-15:
// "the user's own Logs and their connections' Logs together"; this stays
// connection-scoped, not the whole user base). 'connection:<id>' isolates
// a single connection, 403ing if the viewer has no permission at all.
async function resolveOwnerUserIds(
  viewerId: string,
  ownerParam: string | undefined,
): Promise<{ userIds: string[] } | { error: number }> {
  if (!ownerParam || ownerParam === 'mine') {
    return { userIds: [viewerId] };
  }

  if (ownerParam === 'everyone') {
    const connections = await prisma.connection.findMany({
      where: { status: 'accepted', OR: [{ requesterId: viewerId }, { addresseeId: viewerId }] },
    });
    const connectionIds = connections.map((c) => (c.requesterId === viewerId ? c.addresseeId : c.requesterId));
    const visible: string[] = [viewerId];
    for (const id of connectionIds) {
      if (await canView(viewerId, id, 'past_content')) {
        visible.push(id);
      }
    }
    return { userIds: visible };
  }

  if (ownerParam.startsWith('connection:')) {
    const targetId = ownerParam.slice('connection:'.length);
    const allowed = await canView(viewerId, targetId, 'past_content');
    if (!allowed) {
      return { error: 403 };
    }
    return { userIds: [targetId] };
  }

  return { error: 400 };
}

// FR-15/16/17/18/19/26/27: unified spatial view backing endpoint.
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

  const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (statusParam && !(STATUS_VALUES as readonly string[]).includes(statusParam)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const ownerParam = typeof req.query.owner === 'string' ? req.query.owner : undefined;
  const ownerResolution = await resolveOwnerUserIds(req.userId!, ownerParam);
  if ('error' in ownerResolution) {
    res.status(ownerResolution.error).json({ error: ownerResolution.error === 403 ? 'Not permitted' : 'Invalid owner filter' });
    return;
  }
  const ownerUserIds = ownerResolution.userIds;

  const places = await prisma.place.findMany({
    where: {
      lat: { gte: minLat, lte: maxLat },
      lng: { gte: minLng, lte: maxLng },
      ...(categoryParam ? { category: categoryParam as z.infer<typeof categoryEnum> } : {}),
    },
  });

  const placeIds = places.map((place) => place.id);
  const [logs, saves] = await Promise.all([
    prisma.log.findMany({ where: { userId: { in: ownerUserIds }, placeId: { in: placeIds } } }),
    prisma.save.findMany({ where: { userId: { in: ownerUserIds }, placeId: { in: placeIds } } }),
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
