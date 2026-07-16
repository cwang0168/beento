import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { createLog } from '../logs/logs.service';
import { serializeLog } from '../logs/logs.routes';
import { prisma } from '../../prisma';
import { canView } from '../permissions/permissions.service';
import { createSave } from '../saves/saves.service';
import { serializeSave } from '../saves/saves.routes';

export const tripsRouter = Router();

const createTripSchema = z.object({
  title: z.string().min(1),
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
});

// Strict ownership -- the Trip stays owner-curated (co-travelers log
// against its Places but never add/remove them).
async function loadOwnedTrip(tripId: string, userId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.ownerId !== userId) {
    return null;
  }
  return trip;
}

// Owner OR an accepted co-traveler (FR-24/25/33 remainder): read/confirm
// access, never write access to Trip membership.
async function loadAccessibleTrip(tripId: string, userId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    return null;
  }
  if (trip.ownerId === userId) {
    return trip;
  }
  const coTraveler = await prisma.tripCoTraveler.findFirst({
    where: { tripId, userId, inviteStatus: 'accepted' },
  });
  return coTraveler ? trip : null;
}

// Create a Trip: title + date range only, no destination field (FR-21).
tripsRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createTripSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { title, start_date: startDate, end_date: endDate } = parsed.data;
  if (startDate > endDate) {
    res.status(400).json({ error: 'start_date must not be after end_date' });
    return;
  }

  const trip = await prisma.trip.create({
    data: { title, startDate, endDate, ownerId: req.userId! },
  });
  res.status(201).json({ id: trip.id, title: trip.title, start_date: trip.startDate, end_date: trip.endDate });
});

// Owned trips only -- a co-traveler's shared trips don't show up in their
// own "My Trips" list, only via the share/comparison flow (Phase 2 scope).
tripsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const trips = await prisma.trip.findMany({
    where: { ownerId: req.userId },
    orderBy: { startDate: 'desc' },
  });
  res.json(trips.map((trip) => ({ id: trip.id, title: trip.title, start_date: trip.startDate, end_date: trip.endDate })));
});

// Places + the viewer's own Log/Save status per Place, plus which
// permitted co-travelers have visited each Place (FR-24/25 groundwork).
tripsRouter.get('/:id', requireAuth, async (req: AuthedRequest, res) => {
  const viewerId = req.userId!;
  const trip = await loadAccessibleTrip(req.params.id, viewerId);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }

  const tripPlaces = await prisma.tripPlace.findMany({
    where: { tripId: trip.id },
    include: { place: true },
  });
  const placeIds = tripPlaces.map((tp) => tp.placeId);

  const [viewerLogs, viewerSaves, coTravelers] = await Promise.all([
    prisma.log.findMany({ where: { userId: viewerId, placeId: { in: placeIds } } }),
    prisma.save.findMany({ where: { userId: viewerId, placeId: { in: placeIds } } }),
    prisma.tripCoTraveler.findMany({ where: { tripId: trip.id, inviteStatus: 'accepted', userId: { not: null } } }),
  ]);
  const logByPlace = new Map(viewerLogs.map((log) => [log.placeId, log]));
  const saveByPlace = new Map(viewerSaves.map((save) => [save.placeId, save]));

  const travelerIds = [trip.ownerId, ...coTravelers.map((ct) => ct.userId!)].filter((id) => id !== viewerId);
  const visibleTravelerIds: string[] = [];
  for (const id of travelerIds) {
    if (await canView(viewerId, id, 'past_content')) {
      visibleTravelerIds.push(id);
    }
  }
  const otherLogs = await prisma.log.findMany({
    where: { userId: { in: visibleTravelerIds }, placeId: { in: placeIds } },
  });
  const visitorsByPlace = new Map<string, string[]>();
  for (const log of otherLogs) {
    const list = visitorsByPlace.get(log.placeId) ?? [];
    list.push(log.userId);
    visitorsByPlace.set(log.placeId, list);
  }

  res.json({
    id: trip.id,
    title: trip.title,
    start_date: trip.startDate,
    end_date: trip.endDate,
    places: tripPlaces.map(({ place }) => {
      const log = logByPlace.get(place.id);
      return {
        id: place.id,
        name: place.name,
        category: place.category,
        lat: place.lat,
        lng: place.lng,
        status: log ? 'visited' : saveByPlace.has(place.id) ? 'want_to_go' : 'none',
        co_traveler_visited_user_ids: visitorsByPlace.get(place.id) ?? [],
      };
    }),
  });
});

// Add a Place to a Trip, any time, without touching Log/Save (FR-22).
tripsRouter.post('/:id/places', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadOwnedTrip(req.params.id, req.userId!);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
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

  await prisma.tripPlace.upsert({
    where: { tripId_placeId: { tripId: trip.id, placeId } },
    create: { tripId: trip.id, placeId },
    update: {},
  });
  res.status(201).json({ trip_id: trip.id, place_id: placeId });
});

// Remove a Place from a Trip: only deletes the join row, no undo needed (FR-22).
tripsRouter.delete('/:id/places/:placeId', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadOwnedTrip(req.params.id, req.userId!);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  await prisma.tripPlace.deleteMany({ where: { tripId: trip.id, placeId: req.params.placeId } });
  res.status(204).send();
});

// Post-trip prompt (FR-33): owner or an accepted co-traveler, each seeing
// their own missing Logs against the Trip's Places.
tripsRouter.get('/:id/prompt', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadAccessibleTrip(req.params.id, req.userId!);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  if (trip.endDate > new Date()) {
    res.status(400).json({ error: 'Trip has not ended yet' });
    return;
  }

  const tripPlaces = await prisma.tripPlace.findMany({ where: { tripId: trip.id }, include: { place: true } });
  const existingLogs = await prisma.log.findMany({
    where: { userId: req.userId, placeId: { in: tripPlaces.map((tp) => tp.placeId) } },
  });
  const loggedPlaceIds = new Set(existingLogs.map((log) => log.placeId));

  res.json({
    trip_id: trip.id,
    places: tripPlaces
      .filter((tp) => !loggedPlaceIds.has(tp.placeId))
      .map(({ place }) => ({ id: place.id, name: place.name, category: place.category, lat: place.lat, lng: place.lng })),
  });
});

// Batch-confirm which Places were visited (creates Logs, feeding the ranking
// flow) and which weren't (offered as a Save). Owner or accepted
// co-traveler -- each confirms independently, keyed by their own token.
tripsRouter.post('/:id/confirm-logs', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadAccessibleTrip(req.params.id, req.userId!);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  const parsed = z
    .object({ place_ids: z.array(z.string()), not_visited_place_ids: z.array(z.string()) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { place_ids: placeIds, not_visited_place_ids: notVisitedPlaceIds } = parsed.data;
  const userId = req.userId!;

  const logs = [];
  for (const placeId of placeIds) {
    logs.push(await createLog(userId, placeId));
  }
  const saves = [];
  for (const placeId of notVisitedPlaceIds) {
    saves.push(await createSave(userId, placeId));
  }

  res.json({ logs: logs.map(serializeLog), saves: saves.map(serializeSave) });
});

// FR-24: tag a co-traveler. Immediately accepted if already connected to
// the owner, otherwise pending until they view the invite.
tripsRouter.post('/:id/co-travelers', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadOwnedTrip(req.params.id, req.userId!);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  const parsed = z
    .object({ user_id: z.string().optional(), invited_email: z.string().email().optional() })
    .safeParse(req.body);
  if (!parsed.success || (!parsed.data.user_id && !parsed.data.invited_email)) {
    res.status(400).json({ error: 'user_id or invited_email is required' });
    return;
  }
  const { user_id: userId, invited_email: invitedEmail } = parsed.data;

  let inviteStatus: 'pending' | 'accepted' = 'pending';
  if (userId) {
    const connected = await prisma.connection.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: trip.ownerId, addresseeId: userId },
          { requesterId: userId, addresseeId: trip.ownerId },
        ],
      },
    });
    inviteStatus = connected ? 'accepted' : 'pending';
  }

  const coTraveler = await prisma.tripCoTraveler.create({
    data: { tripId: trip.id, userId: userId ?? null, invitedEmail: invitedEmail ?? null, inviteStatus },
  });
  res.status(201).json({
    id: coTraveler.id,
    user_id: coTraveler.userId,
    invited_email: coTraveler.invitedEmail,
    invite_status: coTraveler.inviteStatus,
  });
});

// FR-25: per-place viewer rank + co-traveler ranks + group average.
tripsRouter.get('/:id/comparison', requireAuth, async (req: AuthedRequest, res) => {
  const viewerId = req.userId!;
  const trip = await loadAccessibleTrip(req.params.id, viewerId);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }

  const [tripPlaces, coTravelers] = await Promise.all([
    prisma.tripPlace.findMany({ where: { tripId: trip.id }, include: { place: true } }),
    prisma.tripCoTraveler.findMany({ where: { tripId: trip.id, inviteStatus: 'accepted', userId: { not: null } } }),
  ]);
  const travelerIds = [...new Set([trip.ownerId, ...coTravelers.map((ct) => ct.userId!)])];

  const visibleTravelerIds: string[] = [];
  for (const id of travelerIds) {
    if (id === viewerId || (await canView(viewerId, id, 'past_content'))) {
      visibleTravelerIds.push(id);
    }
  }

  const places = [];
  for (const tp of tripPlaces) {
    const rankings: Array<{ user_id: string; rank_position: number | null }> = [];
    for (const travelerId of visibleTravelerIds) {
      const log = await prisma.log.findUnique({
        where: { placeId_userId: { placeId: tp.placeId, userId: travelerId } },
      });
      rankings.push({ user_id: travelerId, rank_position: log?.rankPosition ?? null });
    }
    const resolved = rankings.map((r) => r.rank_position).filter((p): p is number => p !== null);
    const groupAverage = resolved.length ? resolved.reduce((a, b) => a + b, 0) / resolved.length : null;
    places.push({
      place: { id: tp.place.id, name: tp.place.name, category: tp.place.category },
      rankings,
      group_average: groupAverage,
    });
  }

  res.json({ trip_id: trip.id, places });
});

// FR-13: a UX convenience, not a permission grant -- the recipient's actual
// view still runs entirely through canView (see permissions.service).
tripsRouter.post('/:id/share', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadOwnedTrip(req.params.id, req.userId!);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  const parsed = z.object({ connection_ids: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const validConnections = await prisma.connection.findMany({
    where: {
      id: { in: parsed.data.connection_ids },
      status: 'accepted',
      OR: [{ requesterId: req.userId }, { addresseeId: req.userId }],
    },
  });
  res.json({ trip_id: trip.id, shared_with_connection_ids: validConnections.map((c) => c.id) });
});

// FR-33 remainder: internal/cron-triggered fan-out. Finds each
// account-holding, accepted co-traveler with Places still unlogged.
// Lapsed (never-accepted) invitees receive nothing, by design.
tripsRouter.post('/:id/prompt/notify', async (req, res) => {
  const trip = await prisma.trip.findUnique({
    where: { id: req.params.id },
    include: { coTravelers: true },
  });
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  if (trip.endDate > new Date()) {
    res.status(400).json({ error: 'Trip has not ended yet' });
    return;
  }

  const tripPlaces = await prisma.tripPlace.findMany({ where: { tripId: trip.id } });
  const placeIds = tripPlaces.map((tp) => tp.placeId);
  const eligible = trip.coTravelers.filter((ct) => ct.inviteStatus === 'accepted' && ct.userId !== null);

  const notified = [];
  for (const coTraveler of eligible) {
    const existingLogs = await prisma.log.findMany({
      where: { userId: coTraveler.userId!, placeId: { in: placeIds } },
    });
    const loggedIds = new Set(existingLogs.map((log) => log.placeId));
    const pendingCount = placeIds.filter((id) => !loggedIds.has(id)).length;
    if (pendingCount > 0) {
      notified.push({ user_id: coTraveler.userId, pending_place_count: pendingCount });
    }
  }
  res.json({ trip_id: trip.id, notified });
});
