import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { createLog } from '../logs/logs.service';
import { serializeLog } from '../logs/logs.routes';
import { prisma } from '../../prisma';
import { createSave } from '../saves/saves.service';
import { serializeSave } from '../saves/saves.routes';

export const tripsRouter = Router();

const createTripSchema = z.object({
  title: z.string().min(1),
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
});

async function loadOwnedTrip(tripId: string, userId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip || trip.ownerId !== userId) {
    return null;
  }
  return trip;
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

// Phase 1: owner-only. Co-traveler visibility is Phase 2.
tripsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const trips = await prisma.trip.findMany({
    where: { ownerId: req.userId },
    orderBy: { startDate: 'desc' },
  });
  res.json(trips.map((trip) => ({ id: trip.id, title: trip.title, start_date: trip.startDate, end_date: trip.endDate })));
});

// Places + the viewer's own Log/Save status per Place.
tripsRouter.get('/:id', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadOwnedTrip(req.params.id, req.userId!);
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }

  const tripPlaces = await prisma.tripPlace.findMany({
    where: { tripId: trip.id },
    include: { place: true },
  });

  const placeIds = tripPlaces.map((tp) => tp.placeId);
  const [logs, saves] = await Promise.all([
    prisma.log.findMany({ where: { userId: req.userId, placeId: { in: placeIds } } }),
    prisma.save.findMany({ where: { userId: req.userId, placeId: { in: placeIds } } }),
  ]);
  const logByPlace = new Map(logs.map((log) => [log.placeId, log]));
  const saveByPlace = new Map(saves.map((save) => [save.placeId, save]));

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

// Post-trip prompt, owner-only slice (FR-33, Phase 1). Full co-traveler
// fan-out is Phase 2.
tripsRouter.get('/:id/prompt', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadOwnedTrip(req.params.id, req.userId!);
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
// flow) and which weren't (offered as a Save, per the PRD's design note).
tripsRouter.post('/:id/confirm-logs', requireAuth, async (req: AuthedRequest, res) => {
  const trip = await loadOwnedTrip(req.params.id, req.userId!);
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
