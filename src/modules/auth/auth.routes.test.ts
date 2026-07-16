import request from 'supertest';
import { createApp } from '../../app';
import { prisma } from '../../prisma';
import { resetDatabase } from '../../test/db';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /auth/signup', () => {
  it('creates a user and returns a token', async () => {
    const res = await request(app).post('/auth/signup').send({
      email: 'a@example.com',
      password: 'password123',
      display_name: 'Alice',
      username: 'alice',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('rejects a duplicate email', async () => {
    await request(app).post('/auth/signup').send({
      email: 'a@example.com',
      password: 'password123',
      display_name: 'Alice',
      username: 'alice',
    });
    const res = await request(app).post('/auth/signup').send({
      email: 'a@example.com',
      password: 'password123',
      display_name: 'Alice2',
      username: 'alice2',
    });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid payload', async () => {
    const res = await request(app).post('/auth/signup').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('returns a token for correct credentials', async () => {
    await request(app).post('/auth/signup').send({
      email: 'a@example.com',
      password: 'password123',
      display_name: 'Alice',
      username: 'alice',
    });
    const res = await request(app).post('/auth/login').send({
      email: 'a@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('rejects a wrong password', async () => {
    await request(app).post('/auth/signup').send({
      email: 'a@example.com',
      password: 'password123',
      display_name: 'Alice',
      username: 'alice',
    });
    const res = await request(app).post('/auth/login').send({
      email: 'a@example.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'nobody@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(401);
  });
});
