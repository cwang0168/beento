import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { macroRegionFor } from './macroRegion';
import { clusterLogsForTripSuggestions, clusterSignature, TripCluster } from './tripClustering';

export const tripSuggestionsRouter = Router();

async function unassignedLogsCluster(userId: string): Promise<TripCluster[]> {
  const tripPlaceIds = await prisma.tripPlace.findMany({
    where: { trip: { ownerId: userId } },
    select: { placeId: true },
  });
  const assignedPlaceIds = new Set(tripPlaceIds.map((tp) => tp.placeId));

  // Logs are the timestamped evidence the suggestion reads from, regardless
  // of ranking status -- a log mid-comparison is still valid trip evidence,
  // since ranking and trip membership are orthogonal (Entity Model).
  const logs = await prisma.log.findMany({
    where: { userId },
    include: { place: true },
  });
  const unassigned = logs.filter((log) => !assignedPlaceIds.has(log.placeId));

  return clusterLogsForTripSuggestions(
    unassigned.map((log) => ({ placeId: log.placeId, lat: log.place.lat, lng: log.place.lng, loggedAt: log.loggedAt })),
  );
}

function suggestedTitle(regions: string[]): string {
  const unique = [...new Set(regions)];
  const readable = unique.map((r) => r.replace(/_/g, ' ')).join(' + ');
  return readable
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// FR-23: candidate trips assembled from the viewer's own recent Log
// clusters. No special-cased reason field on empty -- unlike FR-20's
// cohort gap, this has no unresolved product question behind it.
tripSuggestionsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const clusters = await unassignedLogsCluster(userId);

  const dismissals = await prisma.tripSuggestionDismissal.findMany({ where: { userId } });
  const dismissedSignatures = new Set(dismissals.map((d) => d.clusterSignature));

  const places = await prisma.place.findMany({
    where: { id: { in: [...new Set(clusters.flatMap((c) => c.placeIds))] } },
  });
  const placeById = new Map(places.map((p) => [p.id, p]));

  const suggestions = clusters
    .map((cluster) => ({ cluster, signature: clusterSignature(cluster.placeIds) }))
    .filter(({ signature }) => !dismissedSignatures.has(signature))
    .map(({ cluster, signature }) => {
      const regions = cluster.placeIds.map((id) => {
        const place = placeById.get(id)!;
        return macroRegionFor(place.lat, place.lng);
      });
      return {
        signature,
        suggested_title: suggestedTitle(regions),
        start_date: cluster.startDate,
        end_date: cluster.endDate,
        place_ids: cluster.placeIds,
      };
    });

  res.json(suggestions);
});

// Accepting calls the same Trip-creation path as POST /trips + POST
// /trips/:id/places -- FR-23 produces inputs to FR-21/22, it doesn't
// bypass them.
tripSuggestionsRouter.post('/:signature/accept', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const parsed = z.object({ title: z.string().optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const clusters = await unassignedLogsCluster(userId);
  const match = clusters.find((cluster) => clusterSignature(cluster.placeIds) === req.params.signature);
  if (!match) {
    res.status(409).json({ error: 'This suggestion is no longer valid; refetch /trips/suggestions' });
    return;
  }

  const places = await prisma.place.findMany({ where: { id: { in: match.placeIds } } });
  const regions = places.map((p) => macroRegionFor(p.lat, p.lng));
  const title = parsed.data.title ?? suggestedTitle(regions);

  const trip = await prisma.trip.create({
    data: { title, startDate: match.startDate, endDate: match.endDate, ownerId: userId },
  });
  await prisma.tripPlace.createMany({
    data: match.placeIds.map((placeId) => ({ tripId: trip.id, placeId })),
  });

  res.status(201).json({ id: trip.id, title: trip.title, start_date: trip.startDate, end_date: trip.endDate });
});

tripSuggestionsRouter.post('/:signature/dismiss', requireAuth, async (req: AuthedRequest, res) => {
  await prisma.tripSuggestionDismissal.upsert({
    where: { userId_clusterSignature: { userId: req.userId!, clusterSignature: req.params.signature } },
    create: { userId: req.userId!, clusterSignature: req.params.signature },
    update: {},
  });
  res.status(204).send();
});
