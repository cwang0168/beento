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

describe('POST /reports', () => {
  it('creates a report without affecting the reported user', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_user_id: bUser.id, reason: 'harassment', note: 'unwanted messages' });
    expect(res.status).toBe(201);
    expect(await prisma.report.count()).toBe(1);
    expect(await prisma.block.count()).toBe(0);
    expect(await prisma.connection.count()).toBe(0);
  });

  it('rejects an invalid reason', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reported_user_id: bUser.id, reason: 'not-a-real-reason' });
    expect(res.status).toBe(400);
  });
});
