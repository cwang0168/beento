import express from 'express';
import request from 'supertest';
import { jsonErrorHandler } from './errorHandler';

describe('jsonErrorHandler', () => {
  it('returns a 500 JSON body for an error passed to next()', async () => {
    const app = express();
    app.get('/boom', (_req, _res, next) => next(new Error('kaboom')));
    app.use(jsonErrorHandler);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
