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

async function createPlace(token: string, name: string) {
  const res = await request(app)
    .post('/places')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, category: 'restaurant', lat: 38.7, lng: -9.1 });
  return res.body.id as string;
}

describe('POST /saves', () => {
  it('creates a save', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Time Out Market');
    const res = await request(app).post('/saves').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ place_id: placeId });
  });

  it('is a no-op for a duplicate save', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Time Out Market');
    const first = await request(app).post('/saves').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });
    const second = await request(app).post('/saves').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.save.count()).toBe(1);
  });
});

describe('DELETE /saves/:id', () => {
  it('removes a save owned by the requester', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Time Out Market');
    const save = await request(app).post('/saves').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });

    const res = await request(app).delete(`/saves/${save.body.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(await prisma.save.count()).toBe(0);
  });

  it("404s for another user's save", async () => {
    const owner = await createTestUser(app);
    const other = await createTestUser(app);
    const placeId = await createPlace(owner.token, 'Time Out Market');
    const save = await request(app)
      .post('/saves')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ place_id: placeId });

    const res = await request(app).delete(`/saves/${save.body.id}`).set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
    expect(await prisma.save.count()).toBe(1);
  });
});

describe('GET /saves (FR-9a: visited wins)', () => {
  it('lists saved places not yet logged', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Time Out Market');
    await request(app).post('/saves').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });

    const res = await request(app).get('/saves').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].place.id).toBe(placeId);
  });

  it('hides a place from the want-to-go list once it has been logged, without deleting the Save', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Time Out Market');
    await request(app).post('/saves').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });

    await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });

    const res = await request(app).get('/saves').set('Authorization', `Bearer ${token}`);
    expect(res.body).toEqual([]);
    expect(await prisma.save.count()).toBe(1); // save row survives (FR-9a)
  });
});
