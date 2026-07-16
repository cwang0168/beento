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

describe('POST /blocks', () => {
  it('blocks a user and severs any existing connection', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const aUser = await prisma.user.findUniqueOrThrow({ where: { username: a.username } });
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const connReq = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${b.token}`);
    expect(await prisma.connection.count()).toBe(1);

    const res = await request(app).post('/blocks').set('Authorization', `Bearer ${a.token}`).send({ user_id: bUser.id });
    expect(res.status).toBe(201);
    expect(await prisma.connection.count()).toBe(0);
  });

  it('is idempotent for a duplicate block', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const first = await request(app).post('/blocks').set('Authorization', `Bearer ${a.token}`).send({ user_id: bUser.id });
    const second = await request(app).post('/blocks').set('Authorization', `Bearer ${a.token}`).send({ user_id: bUser.id });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await prisma.block.count()).toBe(1);
  });

  it('lists blocked users', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });
    await request(app).post('/blocks').set('Authorization', `Bearer ${a.token}`).send({ user_id: bUser.id });

    const res = await request(app).get('/blocks').set('Authorization', `Bearer ${a.token}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].user.id).toBe(bUser.id);
  });
});
