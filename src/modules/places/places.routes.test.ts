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

describe('POST /places', () => {
  it('creates a user-created place', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .post('/places')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Time Out Market', category: 'restaurant', source: 'user_created' });
  });

  it('rejects an invalid category', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .post('/places')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Home', category: 'residential', lat: 0, lng: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /places/:id', () => {
  it('returns a created place', async () => {
    const { token } = await createTestUser(app);
    const created = await request(app)
      .post('/places')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459 });

    const res = await request(app)
      .get(`/places/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Time Out Market');
  });

  it('returns 404 for an unknown place', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .get('/places/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /places/search', () => {
  it('filters by name, case-insensitively', async () => {
    const { token } = await createTestUser(app);
    await prisma.place.createMany({
      data: [
        { name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459, source: 'seed' },
        { name: 'Pastéis de Belém', category: 'restaurant', lat: 38.6975, lng: -9.2032, source: 'seed' },
      ],
    });

    const res = await request(app)
      .get('/places/search')
      .query({ q: 'time out' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Time Out Market');
  });

  it('filters by category', async () => {
    const { token } = await createTestUser(app);
    await prisma.place.createMany({
      data: [
        { name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459, source: 'seed' },
        { name: 'Pensão Amor', category: 'bar', lat: 38.7096, lng: -9.1435, source: 'seed' },
      ],
    });

    const res = await request(app)
      .get('/places/search')
      .query({ category: 'bar' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pensão Amor');
  });

  it('sorts by proximity when lat/lng are given', async () => {
    const { token } = await createTestUser(app);
    await prisma.place.createMany({
      data: [
        { name: 'Far Place', category: 'restaurant', lat: 41.1579, lng: -8.6291, source: 'seed' }, // Porto
        { name: 'Near Place', category: 'restaurant', lat: 38.7069, lng: -9.1459, source: 'seed' }, // Lisbon
      ],
    });

    const res = await request(app)
      .get('/places/search')
      .query({ lat: '38.7223', lng: '-9.1393' }) // Lisbon-ish origin
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Near Place');
    expect(res.body[1].name).toBe('Far Place');
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/places/search');
    expect(res.status).toBe(401);
  });
});
