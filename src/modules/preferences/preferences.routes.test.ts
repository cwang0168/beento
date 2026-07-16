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

describe('GET /me/preferences', () => {
  it('returns null preferences for a fresh account', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).get('/me/preferences').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ budget_level: null, pace: null, environment_type: null });
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/me/preferences');
    expect(res.status).toBe(401);
  });
});

describe('PUT /me/preferences', () => {
  it('updates and persists preferences', async () => {
    const { token } = await createTestUser(app);
    const putRes = await request(app)
      .put('/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ budget_level: 'medium', pace: 'relaxed', environment_type: 'urban' });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toEqual({ budget_level: 'medium', pace: 'relaxed', environment_type: 'urban' });

    const getRes = await request(app).get('/me/preferences').set('Authorization', `Bearer ${token}`);
    expect(getRes.body).toEqual({ budget_level: 'medium', pace: 'relaxed', environment_type: 'urban' });
  });

  it('rejects an invalid payload', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .put('/me/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ budget_level: 123 });
    expect(res.status).toBe(400);
  });
});
