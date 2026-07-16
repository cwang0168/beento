import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';
import { evaluateRateLimit } from './rateLimiter';

export const connectionsRouter = Router();

function serializeConnection(connection: { id: string; requesterId: string; addresseeId: string; status: string }) {
  return {
    id: connection.id,
    requester_id: connection.requesterId,
    addressee_id: connection.addresseeId,
    status: connection.status,
  };
}

// FR-10: send a connection request; 429 if rate-limited (Still Open #1).
connectionsRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ addressee_id: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const requesterId = req.userId!;
  const { addressee_id: addresseeId } = parsed.data;

  if (addresseeId === requesterId) {
    res.status(400).json({ error: 'Cannot connect with yourself' });
    return;
  }

  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: requesterId, blockedId: addresseeId },
        { blockerId: addresseeId, blockedId: requesterId },
      ],
    },
  });
  if (blocked) {
    // Generic message -- doesn't confirm a block exists either way (§6).
    res.status(403).json({ error: 'Unable to connect' });
    return;
  }

  const rateLimitRow = await prisma.connectionRequestRateLimit.findUnique({ where: { requesterId } });
  const decision = evaluateRateLimit(
    rateLimitRow ? { windowStart: rateLimitRow.windowStart, requestCount: rateLimitRow.requestCount } : null,
    new Date(),
  );
  if (!decision.allowed) {
    res.status(429).json({ error: 'Too many connection requests', retry_after: Math.ceil(decision.retryAfterMs / 1000) });
    return;
  }
  await prisma.connectionRequestRateLimit.upsert({
    where: { requesterId },
    create: { requesterId, windowStart: decision.nextState.windowStart, requestCount: decision.nextState.requestCount },
    update: { windowStart: decision.nextState.windowStart, requestCount: decision.nextState.requestCount },
  });

  const existing = await prisma.connection.findUnique({
    where: { requesterId_addresseeId: { requesterId, addresseeId } },
  });
  if (existing) {
    res.status(200).json(serializeConnection(existing));
    return;
  }

  const connection = await prisma.connection.create({ data: { requesterId, addresseeId } });
  res.status(201).json(serializeConnection(connection));
});

// Accepted connections only.
connectionsRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const connections = await prisma.connection.findMany({
    where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: { requester: true, addressee: true },
  });
  res.json(
    connections.map((connection) => {
      const other = connection.requesterId === userId ? connection.addressee : connection.requester;
      return {
        id: connection.id,
        user: { id: other.id, display_name: other.displayName, username: other.username },
      };
    }),
  );
});

// Pending incoming requests.
connectionsRouter.get('/requests', requireAuth, async (req: AuthedRequest, res) => {
  const requests = await prisma.connection.findMany({
    where: { addresseeId: req.userId, status: 'pending' },
    include: { requester: true },
  });
  res.json(
    requests.map((request) => ({
      id: request.id,
      requester: { id: request.requester.id, display_name: request.requester.displayName, username: request.requester.username },
    })),
  );
});

connectionsRouter.post('/:id/accept', requireAuth, async (req: AuthedRequest, res) => {
  const connection = await prisma.connection.findUnique({ where: { id: req.params.id } });
  if (!connection || connection.addresseeId !== req.userId) {
    res.status(404).json({ error: 'Connection request not found' });
    return;
  }
  const updated = await prisma.connection.update({ where: { id: connection.id }, data: { status: 'accepted' } });
  res.json(serializeConnection(updated));
});

// Declining deletes the row outright -- no state retained, so the
// requester can try again later (no rate-limit exemption for re-requests).
connectionsRouter.post('/:id/decline', requireAuth, async (req: AuthedRequest, res) => {
  const connection = await prisma.connection.findUnique({ where: { id: req.params.id } });
  if (!connection || connection.addresseeId !== req.userId) {
    res.status(404).json({ error: 'Connection request not found' });
    return;
  }
  await prisma.connection.delete({ where: { id: connection.id } });
  res.status(204).send();
});

// FR-34 disconnect: hard delete, idempotent (repeat calls just no-op).
connectionsRouter.delete('/:id', requireAuth, async (req: AuthedRequest, res) => {
  const connection = await prisma.connection.findUnique({ where: { id: req.params.id } });
  if (connection && (connection.requesterId === req.userId || connection.addresseeId === req.userId)) {
    await prisma.connection.delete({ where: { id: connection.id } });
  }
  res.status(204).send();
});
