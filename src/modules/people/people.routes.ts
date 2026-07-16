import { Router } from 'express';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';

export const peopleRouter = Router();

// FR-30: name/username only, no opt-out -- this endpoint never 403s on a
// valid query, it only ever affects what a *result* discloses (NFR-4a),
// never whether the person is returned.
peopleRouter.get('/search', requireAuth, async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  if (!q) {
    res.status(400).json({ error: 'q is required' });
    return;
  }
  const userId = req.userId!;

  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
  });
  const excludeIds = new Set<string>([userId]);
  for (const block of blocks) {
    excludeIds.add(block.blockerId);
    excludeIds.add(block.blockedId);
  }

  const users = await prisma.user.findMany({
    where: {
      id: { notIn: [...excludeIds] },
      OR: [
        { displayName: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 20,
  });

  const connections = await prisma.connection.findMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: { in: users.map((u) => u.id) } },
        { addresseeId: userId, requesterId: { in: users.map((u) => u.id) } },
      ],
    },
  });
  const statusByOtherUser = new Map<string, string>();
  for (const connection of connections) {
    const otherId = connection.requesterId === userId ? connection.addresseeId : connection.requesterId;
    statusByOtherUser.set(otherId, connection.status);
  }

  res.json(
    users.map((user) => ({
      id: user.id,
      name: user.displayName,
      username: user.username,
      connection_status: statusByOtherUser.get(user.id) ?? 'none',
    })),
  );
});
