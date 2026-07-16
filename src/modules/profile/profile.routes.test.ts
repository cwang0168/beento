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
  return prisma.place.create({ data: { name, category: 'restaurant', lat: 38.7, lng: -9.1, source: 'seed' } });
}

describe('GET /me/profile/publish-preview', () => {
  it('counts logged places and completed trips only', async () => {
    const a = await createTestUser(app);
    const place = await createPlace('Time Out Market');
    await request(app).post('/logs').set('Authorization', `Bearer ${a.token}`).send({ place_id: place.id });
    await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ title: 'Past Trip', start_date: '2020-01-01', end_date: '2020-01-05' });
    await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ title: 'Future Trip', start_date: '2999-01-01', end_date: '2999-01-05' });

    const res = await request(app).get('/me/profile/publish-preview').set('Authorization', `Bearer ${a.token}`);
    expect(res.body).toEqual({ visible_place_count: 1, visible_trip_count: 1 });
  });
});

describe('PUT /me/profile', () => {
  it('toggles profile_public', async () => {
    const a = await createTestUser(app);
    const res = await request(app).put('/me/profile').set('Authorization', `Bearer ${a.token}`).send({ public: true });
    expect(res.body).toEqual({ public: true });

    const back = await request(app).put('/me/profile').set('Authorization', `Bearer ${a.token}`).send({ public: false });
    expect(back.body).toEqual({ public: false });
  });
});
