import request from 'supertest';
import { createApp } from '../../app';
import { prisma } from '../../prisma';
import { resetDatabase } from '../../test/db';
import { createTestUser } from '../../test/helpers';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function logPlaceAt(token: string, name: string, lat: number, lng: number, loggedAt: Date) {
  const place = await prisma.place.create({ data: { name, category: 'restaurant', lat, lng, source: 'seed' } });
  const logRes = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: place.id });
  await prisma.log.update({ where: { id: logRes.body.id }, data: { loggedAt } });
  return place.id;
}

describe('GET /trips/suggestions', () => {
  it('suggests a cluster of 2+ nearby, close-in-time logs', async () => {
    const { token } = await createTestUser(app);
    const base = new Date('2026-01-01T00:00:00Z');
    await logPlaceAt(token, 'Time Out Market', 38.7069, -9.1459, base);
    await logPlaceAt(token, 'Cervejaria Ramiro', 38.7223, -9.1361, new Date(base.getTime() + 10 * 60 * 60 * 1000));

    const res = await request(app).get('/trips/suggestions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].place_ids).toHaveLength(2);
    expect(res.body[0].suggested_title).toContain('Western Europe');
  });

  it('does not suggest a single isolated log', async () => {
    const { token } = await createTestUser(app);
    await logPlaceAt(token, 'Time Out Market', 38.7069, -9.1459, new Date());

    const res = await request(app).get('/trips/suggestions').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual([]);
  });

  it('excludes logs already assigned to a trip', async () => {
    const { token } = await createTestUser(app);
    const base = new Date('2026-01-01T00:00:00Z');
    const placeA = await logPlaceAt(token, 'Time Out Market', 38.7069, -9.1459, base);
    await logPlaceAt(token, 'Cervejaria Ramiro', 38.7223, -9.1361, new Date(base.getTime() + 10 * 60 * 60 * 1000));

    const trip = await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Manual Trip', start_date: '2026-01-01', end_date: '2026-01-02' });
    await request(app).post(`/trips/${trip.body.id}/places`).set('Authorization', `Bearer ${token}`).send({ place_id: placeA });

    const res = await request(app).get('/trips/suggestions').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual([]); // the remaining single log alone isn't a cluster
  });
});

describe('POST /trips/suggestions/:signature/accept', () => {
  it('creates a real Trip via the same path as POST /trips + POST /trips/:id/places', async () => {
    const { token } = await createTestUser(app);
    const base = new Date('2026-01-01T00:00:00Z');
    await logPlaceAt(token, 'Time Out Market', 38.7069, -9.1459, base);
    await logPlaceAt(token, 'Cervejaria Ramiro', 38.7223, -9.1361, new Date(base.getTime() + 10 * 60 * 60 * 1000));

    const suggestions = await request(app).get('/trips/suggestions').set('Authorization', `Bearer ${token}`);
    const signature = suggestions.body[0].signature;

    const res = await request(app)
      .post(`/trips/suggestions/${signature}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);

    const tripDetail = await request(app).get(`/trips/${res.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(tripDetail.body.places).toHaveLength(2);
  });

  it('409s for a signature that no longer matches any cluster', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .post('/trips/suggestions/not-a-real-signature/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(409);
  });
});

describe('POST /trips/suggestions/:signature/dismiss', () => {
  it('prevents the identical cluster from resurfacing', async () => {
    const { token } = await createTestUser(app);
    const base = new Date('2026-01-01T00:00:00Z');
    await logPlaceAt(token, 'Time Out Market', 38.7069, -9.1459, base);
    await logPlaceAt(token, 'Cervejaria Ramiro', 38.7223, -9.1361, new Date(base.getTime() + 10 * 60 * 60 * 1000));

    const before = await request(app).get('/trips/suggestions').set('Authorization', `Bearer ${token}`);
    const signature = before.body[0].signature;

    const dismiss = await request(app).post(`/trips/suggestions/${signature}/dismiss`).set('Authorization', `Bearer ${token}`);
    expect(dismiss.status).toBe(204);

    const after = await request(app).get('/trips/suggestions').set('Authorization', `Bearer ${token}`);
    expect(after.body).toEqual([]);
  });
});
