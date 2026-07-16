import { prisma } from '../../prisma';

export interface SaveResult {
  id: string;
  placeId: string;
  savedAt: Date;
}

// Shared by POST /saves and the trip post-trip confirm-logs batch endpoint
// (a Place marked "not visited" is offered as a Save). No-op on duplicate.
export async function createSave(userId: string, placeId: string): Promise<SaveResult> {
  const existing = await prisma.save.findUnique({ where: { placeId_userId: { placeId, userId } } });
  if (existing) {
    return existing;
  }
  return prisma.save.create({ data: { placeId, userId } });
}
