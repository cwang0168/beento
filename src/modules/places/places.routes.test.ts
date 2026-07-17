import request from 'supertest';
import { createApp } from '../../app';
import { config } from '../../config';
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

  it('surfaces connection_activity and boosts results with it (FR-32)', async () => {
    const viewer = await createTestUser(app);
    const friend = await createTestUser(app);
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });
    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ addressee_id: friendUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${friend.token}`);

    await prisma.place.createMany({
      data: [
        { name: 'No Activity Place', category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' },
        { name: 'Friend Logged Place', category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' },
      ],
    });
    const friendPlace = await prisma.place.findFirstOrThrow({ where: { name: 'Friend Logged Place' } });
    await request(app).post('/logs').set('Authorization', `Bearer ${friend.token}`).send({ place_id: friendPlace.id });

    const res = await request(app)
      .get('/places/search')
      .query({ category: 'restaurant' })
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.body[0].name).toBe('Friend Logged Place');
    expect(res.body[0].connection_activity).toEqual([
      { user_id: friendUser.id, type: 'log', rank_position: 1 },
    ]);
    expect(res.body[1].connection_activity).toEqual([]);
  });
});

describe('GET /places/search with GOOGLE_PLACES_API_KEY configured', () => {
  const originalKey = config.googlePlacesApiKey;
  const originalFetch = global.fetch;

  afterEach(() => {
    config.googlePlacesApiKey = originalKey;
    global.fetch = originalFetch;
  });

  it('materializes a new Google result as a local Place and includes it in results', async () => {
    config.googlePlacesApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            id: 'ChIJ-timeout',
            displayName: { text: 'Time Out Market' },
            location: { latitude: 38.7069, longitude: -9.1459 },
            types: ['restaurant'],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const { token } = await createTestUser(app);
    const res = await request(app).get('/places/search').query({ q: 'Time Out' }).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'Time Out Market', category: 'restaurant', source: 'google_places' });

    const stored = await prisma.place.findUniqueOrThrow({ where: { externalId: 'ChIJ-timeout' } });
    expect(stored.name).toBe('Time Out Market');
  });

  it('does not duplicate a Google result already materialized locally', async () => {
    config.googlePlacesApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            id: 'ChIJ-timeout',
            displayName: { text: 'Time Out Market' },
            location: { latitude: 38.7069, longitude: -9.1459 },
            types: ['restaurant'],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const { token } = await createTestUser(app);
    await request(app).get('/places/search').query({ q: 'Time Out' }).set('Authorization', `Bearer ${token}`);
    const res = await request(app).get('/places/search').query({ q: 'Time Out' }).set('Authorization', `Bearer ${token}`);

    expect(res.body).toHaveLength(1);
    const count = await prisma.place.count({ where: { externalId: 'ChIJ-timeout' } });
    expect(count).toBe(1);
  });
});

describe('GET /places/:id/visitors (FR-12)', () => {
  it('shows only visitors the viewer is permitted to see', async () => {
    const viewer = await createTestUser(app);
    const connectedFriend = await createTestUser(app);
    const stranger = await createTestUser(app);
    const connectedUser = await prisma.user.findUniqueOrThrow({ where: { username: connectedFriend.username } });

    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ addressee_id: connectedUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${connectedFriend.token}`);

    const place = await prisma.place.create({ data: { name: 'Time Out Market', category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' } });
    await request(app).post('/logs').set('Authorization', `Bearer ${connectedFriend.token}`).send({ place_id: place.id });
    await request(app).post('/logs').set('Authorization', `Bearer ${stranger.token}`).send({ place_id: place.id });

    const res = await request(app).get(`/places/${place.id}/visitors`).set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].user.id).toBe(connectedUser.id);
  });
});
