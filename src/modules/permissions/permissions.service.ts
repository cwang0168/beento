import { prisma } from '../../prisma';

export type ContentClass = 'profile_identity' | 'past_content' | 'future_trip' | 'save';

// NFR-4 family: the single check everything in Phase 2 funnels through,
// because NFR-4f is explicit that there is no partial visibility.
export async function canView(viewerId: string, targetUserId: string, contentClass: ContentClass): Promise<boolean> {
  if (viewerId === targetUserId) {
    return true;
  }

  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: viewerId, blockedId: targetUserId },
        { blockerId: targetUserId, blockedId: viewerId },
      ],
    },
  });
  if (blocked) {
    return false;
  }

  if (contentClass === 'profile_identity') {
    // FR-30: name/handle/photo always resolvable, no opt-out.
    return true;
  }

  const connection = await prisma.connection.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: viewerId, addresseeId: targetUserId },
        { requesterId: targetUserId, addresseeId: viewerId },
      ],
    },
  });
  if (connection) {
    // NFR-4f: an accepted connection is a total grant.
    return true;
  }

  if (contentClass === 'past_content') {
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    return target?.profilePublic ?? false;
  }

  // future_trip / save: NFR-4d -- public profiles never expose these to non-connections.
  return false;
}
