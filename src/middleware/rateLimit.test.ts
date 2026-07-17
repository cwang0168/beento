import express from 'express';
import request from 'supertest';
import { createRateLimiter } from './rateLimit';

// createRateLimiter skips itself when NODE_ENV==='test' (the app-wide
// limiters need to, or the existing integration suite would trip them) --
// so this test explicitly overrides NODE_ENV around a standalone instance
// to verify the underlying mechanism actually blocks requests.
describe('createRateLimiter', () => {
  it('blocks requests once the limit is exceeded within the window', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = express();
      app.use(createRateLimiter({ windowMs: 60_000, limit: 2 }));
      app.get('/ping', (_req, res) => res.json({ ok: true }));

      const first = await request(app).get('/ping');
      const second = await request(app).get('/ping');
      const third = await request(app).get('/ping');

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('is a no-op under NODE_ENV=test', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, limit: 1 }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const first = await request(app).get('/ping');
    const second = await request(app).get('/ping');
    const third = await request(app).get('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
  });
});
