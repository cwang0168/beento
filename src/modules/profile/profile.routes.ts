import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';

export const profileRouter = Router();

async function visibleCounts(userId: string) {
  const [placeCount, tripCount] = await Promise.all([
    prisma.log.count({ where: { userId, rankPosition: { not: null } } }),
    prisma.trip.count({ where: { ownerId: userId, endDate: { lt: new Date() } } }),
  ]);
  return { placeCount, tripCount };
}

// NFR-4e: the client must fetch this and show the counts before confirming
// the PUT below. The API doesn't enforce ordering (a UX requirement, not a
// security one) -- the risk is a surprised user, not an attacker.
profileRouter.get('/publish-preview', requireAuth, async (req: AuthedRequest, res) => {
  const { placeCount, tripCount } = await visibleCounts(req.userId!);
  res.json({ visible_place_count: placeCount, visible_trip_count: tripCount });
});

profileRouter.put('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ public: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { profilePublic: parsed.data.public },
  });
  res.json({ public: user.profilePublic });
});
