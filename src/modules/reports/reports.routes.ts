import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';

export const reportsRouter = Router();

const reasonEnum = z.enum(['harassment', 'spam', 'impersonation', 'other']);

// Fire-and-forget from the client's perspective (Still Open #1): doesn't
// block, disconnect, or notify the reported user. Populates a review queue
// only -- building that queue's admin UI is out of scope for this phase.
reportsRouter.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ reported_user_id: z.string(), reason: reasonEnum, note: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const report = await prisma.report.create({
    data: {
      reporterId: req.userId!,
      reportedUserId: parsed.data.reported_user_id,
      reason: parsed.data.reason,
      note: parsed.data.note,
    },
  });
  res.status(201).json({ id: report.id });
});
