import { prisma } from '../../prisma';

// App Store guideline 5.1.1(v): an app that supports account creation must
// let a user delete their account in-app. Hard-deletes everything owned by
// or referencing this user, in FK-safe (children-before-parents) order, in
// one transaction so a mid-way failure can't leave a half-deleted account.
//
// Places the user created are the one exception -- they're shared/global
// (other users may have Logs/Saves against them), so createdById is nulled
// out instead of deleting the Place.
export async function deleteAccount(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ownedTripIds = (await tx.trip.findMany({ where: { ownerId: userId }, select: { id: true } })).map(
      (t) => t.id,
    );

    await tx.tripSuggestionDismissal.deleteMany({ where: { userId } });
    await tx.userSimilarityCache.deleteMany({ where: { OR: [{ userId }, { similarUserId: userId }] } });
    await tx.report.deleteMany({ where: { OR: [{ reporterId: userId }, { reportedUserId: userId }] } });
    await tx.connectionRequestRateLimit.deleteMany({ where: { requesterId: userId } });
    await tx.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    await tx.connection.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } });
    // Co-traveler links on trips the user doesn't own (their own trips'
    // links get removed below via tripId: { in: ownedTripIds }).
    await tx.tripCoTraveler.deleteMany({ where: { userId } });
    await tx.tripPlace.deleteMany({ where: { tripId: { in: ownedTripIds } } });
    await tx.tripCoTraveler.deleteMany({ where: { tripId: { in: ownedTripIds } } });
    await tx.trip.deleteMany({ where: { id: { in: ownedTripIds } } });
    await tx.log.deleteMany({ where: { userId } });
    await tx.save.deleteMany({ where: { userId } });
    await tx.place.updateMany({ where: { createdById: userId }, data: { createdById: null } });
    await tx.user.delete({ where: { id: userId } });
  });
}
