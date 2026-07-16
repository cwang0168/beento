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

describe('GET /people/search', () => {
  it('finds a user by name or username', async () => {
    const a = await createTestUser(app);
    await createTestUser(app, { username: 'aliceinlisbon' });

    const res = await request(app).get('/people/search').query({ q: 'aliceinlisbon' }).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].username).toBe('aliceinlisbon');
  });

  it('excludes users blocked in either direction', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app, { username: 'blockedbya' });
    const c = await createTestUser(app, { username: 'blockedbyc' });
    const aUser = await prisma.user.findUniqueOrThrow({ where: { username: a.username } });
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });
    const cUser = await prisma.user.findUniqueOrThrow({ where: { username: c.username } });

    await prisma.block.create({ data: { blockerId: aUser.id, blockedId: bUser.id } });
    await prisma.block.create({ data: { blockerId: cUser.id, blockedId: aUser.id } });

    const resB = await request(app).get('/people/search').query({ q: 'blockedbya' }).set('Authorization', `Bearer ${a.token}`);
    expect(resB.body).toHaveLength(0);

    const resC = await request(app).get('/people/search').query({ q: 'blockedbyc' }).set('Authorization', `Bearer ${a.token}`);
    expect(resC.body).toHaveLength(0);
  });

  it('never returns the searching user themselves', async () => {
    const a = await createTestUser(app, { username: 'selfsearch' });
    const res = await request(app).get('/people/search').query({ q: 'selfsearch' }).set('Authorization', `Bearer ${a.token}`);
    expect(res.body).toHaveLength(0);
  });

  it('reports connection_status for an existing accepted connection', async () => {
    const a = await createTestUser(app);
    const b = await createTestUser(app, { username: 'connectedperson' });
    const bUser = await prisma.user.findUniqueOrThrow({ where: { username: b.username } });
    const connReq = await request(app).post('/connections').set('Authorization', `Bearer ${a.token}`).send({ addressee_id: bUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${b.token}`);

    const res = await request(app).get('/people/search').query({ q: 'connectedperson' }).set('Authorization', `Bearer ${a.token}`);
    expect(res.body[0].connection_status).toBe('accepted');
  });
});
