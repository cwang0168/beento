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

describe('POST /connections', () => {
  it('creates a pending request', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ addressee_id: bUser.id });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
  });

  it('is a no-op for a duplicate request', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const first = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    const second = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it('rejects a request to a user who has blocked the requester', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const aUser = await prisma.user.findUniqueOrThrow({ where: { username: a.username } });
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });
    await prisma.block.create({ data: { blockerId: bUser.id, blockedId: aUser.id } });

    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ addressee_id: bUser.id });
    expect(res.status).toBe(403);
  });

  it('429s once the rate limit is exceeded', async () => {
    const a = await createTestUser(app);
    const aUser = await prisma.user.findUniqueOrThrow({ where: { username: a.username } });
    await prisma.connectionRequestRateLimit.create({
      data: { requesterId: aUser.id, windowStart: new Date(), requestCount: 20 },
    });
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const res = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ addressee_id: bUser.id });
    expect(res.status).toBe(429);
  });
});

describe('accept / decline / disconnect', () => {
  it('accept flips status and the connection appears in GET /connections for both users', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const req1 = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    await request(app).post(`/connections/${req1.body.id}/accept`).set('Authorization', `Bearer ${b.token}`);

    const aList = await request(app).get('/connections').set('Authorization', `Bearer ${a.token}`);
    const bList = await request(app).get('/connections').set('Authorization', `Bearer ${b.token}`);
    expect(aList.body).toHaveLength(1);
    expect(bList.body).toHaveLength(1);
  });

  it('decline deletes the request so the requester can try again', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const req1 = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    const decline = await request(app).post(`/connections/${req1.body.id}/decline`).set('Authorization', `Bearer ${b.token}`);
    expect(decline.status).toBe(204);

    const retry = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    expect(retry.status).toBe(201);
  });

  it('disconnect revokes access immediately and is idempotent', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const req1 = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    await request(app).post(`/connections/${req1.body.id}/accept`).set('Authorization', `Bearer ${b.token}`);

    const disconnect1 = await request(app).delete(`/connections/${req1.body.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(disconnect1.status).toBe(204);
    const disconnect2 = await request(app).delete(`/connections/${req1.body.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(disconnect2.status).toBe(204); // idempotent, not 404

    const aList = await request(app).get('/connections').set('Authorization', `Bearer ${a.token}`);
    expect(aList.body).toHaveLength(0);
  });
});
