import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { verifyPassword } from '../auth/auth.service';
import { prisma } from '../../prisma';
import { deleteAccount } from './account.service';

export const accountRouter = Router();

const deleteAccountSchema = z.object({ password: z.string().min(1) });

// App Store guideline 5.1.1(v) -- account deletion has to live in-app, not
// just on a website. Requires re-entering the password as confirmation for
// an action that's otherwise irreversible (see account.service.ts).
accountRouter.delete('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  await deleteAccount(req.userId!);
  res.status(204).send();
});
