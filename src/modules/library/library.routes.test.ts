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
  return prisma.place.create({
    data: { name, category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' },
  });
}

describe('GET /library/search', () => {
  it('requires a query', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).get('/library/search').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('finds a matching Log, Save, and Trip by name, case-insensitively', async () => {
    const { token } = await createTestUser(app);
    const loggedPlace = await createPlace('Time Out Market');
    const savedPlace = await createPlace('Time Out Rooftop');
    await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: loggedPlace.id });
    await request(app).post('/saves').set('Authorization', `Bearer ${token}`).send({ place_id: savedPlace.id });
    await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Time Out Weekend', start_date: '2026-01-01', end_date: '2026-01-02' });

    const res = await request(app).get('/library/search').query({ q: 'time out' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.saves).toHaveLength(1);
    expect(res.body.trips).toHaveLength(1);
  });

  it('does not return another user\'s logs', async () => {
    const owner = await createTestUser(app);
    const other = await createTestUser(app);
    const place = await createPlace('Time Out Market');
    await request(app).post('/logs').set('Authorization', `Bearer ${owner.token}`).send({ place_id: place.id });

    const res = await request(app)
      .get('/library/search')
      .query({ q: 'time out' })
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.body.logs).toHaveLength(0);
  });

  it('returns empty results for a non-matching query', async () => {
    const { token } = await createTestUser(app);
    await createPlace('Time Out Market');
    const res = await request(app).get('/library/search').query({ q: 'nonexistent' }).set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual({ logs: [], saves: [], trips: [] });
  });
});
