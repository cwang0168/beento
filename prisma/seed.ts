import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Mock POI dataset standing in for a real geo provider (D-1), per the
// Phase 1 design doc's "mocked externals" decision -- ordinary Place rows
// with source='seed', not a live geocoding call.
const SEED_PLACES = [
  { name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459 },
  { name: 'Cervejaria Ramiro', category: 'restaurant', lat: 38.7223, lng: -9.1361 },
  { name: 'Pastéis de Belém', category: 'restaurant', lat: 38.6975, lng: -9.2032 },
  { name: 'Pensão Amor', category: 'bar', lat: 38.7096, lng: -9.1435 },
  { name: 'Park Bar', category: 'bar', lat: 38.7112, lng: -9.1466 },
  { name: 'Memmo Alfama', category: 'hotel', lat: 38.7115, lng: -9.1296 },
  { name: 'The Lumiares', category: 'hotel', lat: 38.7146, lng: -9.1436 },
  { name: 'LX Factory', category: 'activity', lat: 38.7038, lng: -9.1783 },
  { name: 'Miradouro da Senhora do Monte', category: 'activity', lat: 38.7195, lng: -9.1307 },
  { name: 'Oceanário de Lisboa', category: 'activity', lat: 38.7634, lng: -9.0937 },
] as const;

async function main(): Promise<void> {
  for (const place of SEED_PLACES) {
    // No natural unique key on name; check-then-create avoids duplicates on reseed.
    const existing = await prisma.place.findFirst({ where: { name: place.name, source: 'seed' } });
    if (!existing) {
      await prisma.place.create({ data: { ...place, source: 'seed' } });
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${SEED_PLACES.length} places.`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
