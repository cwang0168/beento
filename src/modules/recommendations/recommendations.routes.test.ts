import request from 'supertest';
import { createApp } from '../../app';
import { prisma } from '../../prisma';
import { resetDatabase } from '../../test/db';
import { createTestUser } from '../../test/helpers';
import { runSimilarityBatch } from './similarityBatch';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makePublicUser(overrides: Partial<{ username: string }> = {}) {
  const { token, username } = await createTestUser(app, overrides);
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.user.update({ where: { id: user.id }, data: { profilePublic: true } });
  return { token, user };
}

describe('GET /recommendations', () => {
  it('returns no_cohort_yet when the cache is empty', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).get('/recommendations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recommendations: [], reason: 'no_cohort_yet' });
  });

  it('serves a recommendation from a cohort of size 1', async () => {
    const viewer = await makePublicUser();
    const similarUser = await makePublicUser();
    const place = await prisma.place.create({
      data: { name: 'Time Out Market', category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' },
    });
    await request(app).post('/logs').set('Authorization', `Bearer ${similarUser.token}`).send({ place_id: place.id });

    await runSimilarityBatch();

    const res = await request(app).get('/recommendations').set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.recommendations).toHaveLength(1);
    expect(res.body.recommendations[0]).toMatchObject({ cohort_size: 1 });
  });

  it('excludes places the viewer has already logged', async () => {
    const viewer = await makePublicUser();
    const similarUser = await makePublicUser();
    const place = await prisma.place.create({
      data: { name: 'Time Out Market', category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' },
    });
    await request(app).post('/logs').set('Authorization', `Bearer ${similarUser.token}`).send({ place_id: place.id });
    await request(app).post('/logs').set('Authorization', `Bearer ${viewer.token}`).send({ place_id: place.id });

    await runSimilarityBatch();

    const res = await request(app).get('/recommendations').set('Authorization', `Bearer ${viewer.token}`);
    expect(res.body.recommendations).toHaveLength(0);
  });

  it('never uses a private user as a similarity candidate (pool-restriction invariant)', async () => {
    const viewer = await makePublicUser();
    const privateUser = await createTestUser(app); // private by default
    const privateUserRow = await prisma.user.findUniqueOrThrow({ where: { username: privateUser.username } });
    const place = await prisma.place.create({
      data: { name: 'Secret Place', category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' },
    });
    await request(app).post('/logs').set('Authorization', `Bearer ${privateUser.token}`).send({ place_id: place.id });

    await runSimilarityBatch();

    expect(await prisma.userSimilarityCache.count({ where: { similarUserId: privateUserRow.id } })).toBe(0);
    const res = await request(app).get('/recommendations').set('Authorization', `Bearer ${viewer.token}`);
    expect(res.body.recommendations).toHaveLength(0);
  });
});
