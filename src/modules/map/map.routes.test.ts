import request from 'supertest';
import { createApp } from '../../app';
import { prisma } from '../../prisma';
import { resetDatabase } from '../../test/db';
import { createTestUser } from '../../test/helpers';

const app = createApp();
const LISBON_BBOX = '38.6,-9.3,38.8,-9.0';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /map/places', () => {
  it('requires a bbox', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).get('/map/places').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns places within the bbox, annotated with owner status', async () => {
    const { token } = await createTestUser(app);
    await prisma.place.createMany({
      data: [
        { name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459, source: 'seed' },
        { name: 'Porto Place', category: 'restaurant', lat: 41.1579, lng: -8.6291, source: 'seed' }, // outside bbox
      ],
    });

    const res = await request(app).get('/map/places').query({ bbox: LISBON_BBOX }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ type: 'place', name: 'Time Out Market', status: 'none' });
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
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, category: 'bar' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pensão Amor');
  });

  it('reflects visited/want_to_go status and filters by status', async () => {
    const { token } = await createTestUser(app);
    const place = await prisma.place.create({
      data: { name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459, source: 'seed' },
    });
    await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: place.id });

    const all = await request(app).get('/map/places').query({ bbox: LISBON_BBOX }).set('Authorization', `Bearer ${token}`);
    expect(all.body[0].status).toBe('visited');

    const wantToGo = await request(app)
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, status: 'want_to_go' })
      .set('Authorization', `Bearer ${token}`);
    expect(wantToGo.body).toHaveLength(0);

    const visited = await request(app)
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, status: 'visited' })
      .set('Authorization', `Bearer ${token}`);
    expect(visited.body).toHaveLength(1);
  });

  it('rejects an unrecognized owner value', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, owner: 'not-a-real-owner-filter' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('collapses a dense area into a cluster (FR-26)', async () => {
    const { token } = await createTestUser(app);
    await prisma.place.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        name: `Place ${i}`,
        category: 'restaurant' as const,
        lat: 38.71 + i * 0.0001,
        lng: -9.14 + i * 0.0001,
        source: 'seed' as const,
      })),
    });

    const res = await request(app).get('/map/places').query({ bbox: LISBON_BBOX }).set('Authorization', `Bearer ${token}`);
    expect(res.body.some((entry: { type: string }) => entry.type === 'cluster')).toBe(true);
  });

  it('owner=everyone includes an accepted connection\'s logs alongside the viewer\'s own', async () => {
    const viewer = await createTestUser(app);
    const friend = await createTestUser(app);
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });
    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ addressee_id: friendUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${friend.token}`);

    const place = await prisma.place.create({
      data: { name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459, source: 'seed' },
    });
    await request(app).post('/logs').set('Authorization', `Bearer ${friend.token}`).send({ place_id: place.id });

    const mine = await request(app)
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, owner: 'mine' })
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(mine.body[0].status).toBe('none');

    const everyone = await request(app)
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, owner: 'everyone' })
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(everyone.body[0].status).toBe('visited');
  });

  it('owner=connection:<id> 403s without permission', async () => {
    const viewer = await createTestUser(app);
    const stranger = await createTestUser(app);
    const strangerUser = await prisma.user.findUniqueOrThrow({ where: { username: stranger.username } });

    const res = await request(app)
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, owner: `connection:${strangerUser.id}` })
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(403);
  });

  it('owner=connection:<id> shows only that connection\'s status', async () => {
    const viewer = await createTestUser(app);
    const friend = await createTestUser(app);
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });
    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ addressee_id: friendUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${friend.token}`);

    const place = await prisma.place.create({
      data: { name: 'Time Out Market', category: 'restaurant', lat: 38.7069, lng: -9.1459, source: 'seed' },
    });
    await request(app).post('/logs').set('Authorization', `Bearer ${friend.token}`).send({ place_id: place.id });

    const res = await request(app)
      .get('/map/places')
      .query({ bbox: LISBON_BBOX, owner: `connection:${friendUser.id}` })
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.body[0].status).toBe('visited');
  });
});
