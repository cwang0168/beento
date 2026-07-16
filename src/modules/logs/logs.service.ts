import { prisma } from '../../prisma';
import { initialBounds } from './ranking';

export interface LogResult {
  id: string;
  placeId: string;
  rankPosition: number | null;
}

// Shared by POST /logs and the trip post-trip confirm-logs batch endpoint.
// Duplicate place+user is a no-op, returning the existing Log.
export async function createLog(userId: string, placeId: string): Promise<LogResult> {
  const place = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });

  const existing = await prisma.log.findUnique({ where: { placeId_userId: { placeId, userId } } });
  if (existing) {
    return existing;
  }

  const existingResolvedCount = await prisma.log.count({
    where: { userId, rankPosition: { not: null }, place: { category: place.category } },
  });
  const bounds = initialBounds(existingResolvedCount);

  return prisma.log.create({
    data: {
      placeId,
      userId,
      rankPosition: bounds === null ? 1 : null,
      rankLow: bounds?.low ?? null,
      rankHigh: bounds?.high ?? null,
    },
  });
}
