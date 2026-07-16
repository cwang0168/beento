import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';

export const savesRouter = Router();

savesRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ place_id: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { place_id: placeId } = parsed.data;
  const userId = req.userId!;

  const place = await prisma.place.findUnique({ where: { id: placeId } });
  if (!place) {
    res.status(404).json({ error: 'Place not found' });
    return;
  }

  const existing = await prisma.save.findUnique({ where: { placeId_userId: { placeId, userId } } });
  if (existing) {
    res.status(200).json({ id: existing.id, place_id: existing.placeId, saved_at: existing.savedAt });
    return;
  }

  const save = await prisma.save.create({ data: { placeId, userId } });
  res.status(201).json({ id: save.id, place_id: save.placeId, saved_at: save.savedAt });
});

savesRouter.delete('/:id', requireAuth, async (req: AuthedRequest, res) => {
  const save = await prisma.save.findUnique({ where: { id: req.params.id } });
  if (!save || save.userId !== req.userId) {
    res.status(404).json({ error: 'Save not found' });
    return;
  }
  await prisma.save.delete({ where: { id: save.id } });
  res.status(204).send();
});

// Visited wins (FR-9a/FR-17): a place with both a Save and a Log for this
// user no longer appears on the want-to-go list, though the Save row is
// kept for provenance.
savesRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const saves = await prisma.save.findMany({
    where: {
      userId,
      place: { logs: { none: { userId } } },
    },
    include: { place: true },
    orderBy: { savedAt: 'desc' },
  });

  res.json(
    saves.map((save) => ({
      id: save.id,
      place: {
        id: save.place.id,
        name: save.place.name,
        category: save.place.category,
        lat: save.place.lat,
        lng: save.place.lng,
      },
      saved_at: save.savedAt,
    })),
  );
});
