import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';

export const blocksRouter = Router();

// FR-34: also severs any existing connection in the same transaction --
// blocking someone you're connected to must revoke their access too.
blocksRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ user_id: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const blockerId = req.userId!;
  const { user_id: blockedId } = parsed.data;

  if (blockedId === blockerId) {
    res.status(400).json({ error: 'Cannot block yourself' });
    return;
  }

  const existing = await prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId, blockedId } } });

  await prisma.$transaction([
    ...(existing
      ? []
      : [
          prisma.block.create({ data: { blockerId, blockedId } }),
        ]),
    prisma.connection.deleteMany({
      where: {
        OR: [
          { requesterId: blockerId, addresseeId: blockedId },
          { requesterId: blockedId, addresseeId: blockerId },
        ],
      },
    }),
  ]);

  res.status(existing ? 200 : 201).json({ blocker_id: blockerId, blocked_id: blockedId });
});

blocksRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const blocks = await prisma.block.findMany({ where: { blockerId: req.userId }, include: { blocked: true } });
  res.json(
    blocks.map((block) => ({
      user: { id: block.blocked.id, display_name: block.blocked.displayName, username: block.blocked.username },
    })),
  );
});
