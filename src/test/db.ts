import { prisma } from '../prisma';

// Deletes rows in FK-safe order. Used by integration tests to isolate cases
// against the same local Postgres instance (docker-compose), not a mock.
export async function resetDatabase(): Promise<void> {
  await prisma.tripCoTraveler.deleteMany();
  await prisma.tripPlace.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.save.deleteMany();
  await prisma.log.deleteMany();
  await prisma.block.deleteMany();
  await prisma.connection.deleteMany();
  await prisma.place.deleteMany();
  await prisma.user.deleteMany();
}
