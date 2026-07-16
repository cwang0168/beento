import { Express } from 'express';
import request from 'supertest';

let counter = 0;

export async function createTestUser(
  app: Express,
  overrides: Partial<{ email: string; username: string }> = {},
): Promise<{ token: string; email: string; username: string }> {
  counter += 1;
  const email = overrides.email ?? `user${counter}@example.com`;
  const username = overrides.username ?? `user${counter}`;
  const res = await request(app).post('/auth/signup').send({
    email,
    password: 'password123',
    display_name: `User ${counter}`,
    username,
  });
  return { token: res.body.token as string, email, username };
}
