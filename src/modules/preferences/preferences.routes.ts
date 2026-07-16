import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../../middleware/auth';
import { prisma } from '../../prisma';

const preferencesSchema = z.object({
  budget_level: z.string().nullable().optional(),
  pace: z.string().nullable().optional(),
  environment_type: z.string().nullable().optional(),
});

function serialize(user: { prefBudgetLevel: string | null; prefPace: string | null; prefEnvironmentType: string | null }) {
  return {
    budget_level: user.prefBudgetLevel,
    pace: user.prefPace,
    environment_type: user.prefEnvironmentType,
  };
}

export const preferencesRouter = Router();

preferencesRouter.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  res.json(serialize(user));
});

preferencesRouter.put('/', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { budget_level: budgetLevel, pace, environment_type: environmentType } = parsed.data;
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      prefBudgetLevel: budgetLevel,
      prefPace: pace,
      prefEnvironmentType: environmentType,
    },
  });
  res.json(serialize(user));
});
