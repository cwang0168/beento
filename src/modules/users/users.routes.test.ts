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

async function createPlace(name: string) {
  return prisma.place.create({ data: { name, category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' } });
}

describe('GET /users/:id/profile', () => {
  it('returns identity only for a private profile with no connection (NFR-4a)', async () => {
    const viewer = await createTestUser(app);
    const target = await createTestUser(app);
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { username: target.username } });
    const place = await createPlace('Time Out Market');
    await request(app).post('/logs').set('Authorization', `Bearer ${target.token}`).send({ place_id: place.id });

    const res = await request(app).get(`/users/${targetUser.id}/profile`).set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: targetUser.id, name: targetUser.displayName, username: targetUser.username });
  });

  it('returns full profile for a public profile with no connection', async () => {
    const viewer = await createTestUser(app);
    const target = await createTestUser(app);
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { username: target.username } });
    await prisma.user.update({ where: { id: targetUser.id }, data: { profilePublic: true } });
    const place = await createPlace('Time Out Market');
    await request(app).post('/logs').set('Authorization', `Bearer ${target.token}`).send({ place_id: place.id });

    const res = await request(app).get(`/users/${targetUser.id}/profile`).set('Authorization', `Bearer ${viewer.token}`);
    expect(res.body).toMatchObject({ place_count: 1 });
  });
});

describe('GET /users/:id/logs (FR-11)', () => {
  it('403s without permission', async () => {
    const viewer = await createTestUser(app);
    const target = await createTestUser(app);
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { username: target.username } });

    const res = await request(app).get(`/users/${targetUser.id}/logs`).set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(403);
  });

  it('returns the ranked list for an accepted connection', async () => {
    const viewer = await createTestUser(app);
    const target = await createTestUser(app);
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { username: target.username } });
    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ addressee_id: targetUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${target.token}`);

    const place = await createPlace('Time Out Market');
    await request(app).post('/logs').set('Authorization', `Bearer ${target.token}`).send({ place_id: place.id });

    const res = await request(app).get(`/users/${targetUser.id}/logs`).set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].place.name).toBe('Time Out Market');
  });
});
