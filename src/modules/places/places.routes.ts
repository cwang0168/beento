import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { haversineDistanceKm } from './places.service';

const categoryEnum = z.enum(['restaurant', 'hotel', 'bar', 'activity']);

const createPlaceSchema = z.object({
  name: z.string().min(1),
  category: categoryEnum,
  lat: z.number(),
  lng: z.number(),
});

export const placesRouter = Router();

// Shared by the FR-4 capture picker and the FR-29 trip planner search.
placesRouter.get('/search', requireAuth, async (req, res) => {
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

  res.json(
    ranked.slice(0, 20).map(({ place, distanceKm }) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      lat: place.lat,
      lng: place.lng,
      source: place.source,
      distance_km: distanceKm,
    })),
  );
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
