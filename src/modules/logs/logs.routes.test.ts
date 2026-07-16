import { Express } from 'express';
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

async function createPlace(token: string, name: string, category = 'restaurant') {
  const res = await request(app)
    .post('/places')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, category, lat: 38.7, lng: -9.1 });
  return res.body.id as string;
}

// Runs the rank-candidates -> rank round trip until the log is resolved,
// always answering that the new log (in-progress) beats the candidate.
async function resolveRankingAlwaysWinning(app: Express, token: string, placeId: string, logId: string) {
  for (;;) {
    const candidateRes = await request(app)
      .get('/logs/rank-candidates')
      .query({ place_id: placeId })
      .set('Authorization', `Bearer ${token}`);
    const rankRes = await request(app)
      .post(`/logs/${logId}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .send({ won_against_log_id: candidateRes.body.candidate_log_id });
    if (!rankRes.body.needs_ranking) {
      return rankRes.body;
    }
  }
}

describe('POST /logs', () => {
  it('assigns rank_position 1 to the first log in a category, no ranking needed', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Time Out Market');

    const res = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ place_id: placeId, rank_position: 1, needs_ranking: false });
  });

  it('requires ranking for the second log in the same category', async () => {
    const { token } = await createTestUser(app);
    const placeA = await createPlace(token, 'Time Out Market');
    const placeB = await createPlace(token, 'Cervejaria Ramiro');

    await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeA });
    const res = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeB });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ place_id: placeB, rank_position: null, needs_ranking: true });
  });

  it('is a no-op for a duplicate place+user log', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Time Out Market');

    const first = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });
    const second = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const count = await prisma.log.count();
    expect(count).toBe(1);
  });

  it('returns 404 for an unknown place', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .post('/logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ place_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });
});

describe('ranking flow (rank-candidates + rank)', () => {
  it('inserts a new always-preferred log at position 1 and shifts the existing one to 2', async () => {
    const { token } = await createTestUser(app);
    const placeA = await createPlace(token, 'Time Out Market');
    const placeB = await createPlace(token, 'Cervejaria Ramiro');

    const logA = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeA });
    const logB = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeB });
    expect(logB.body.needs_ranking).toBe(true);

    const result = await resolveRankingAlwaysWinning(app, token, placeB, logB.body.id);
    expect(result.rank_position).toBe(1);

    const list = await request(app).get('/logs').query({ category: 'restaurant' }).set('Authorization', `Bearer ${token}`);
    expect(list.body.map((l: { id: string }) => l.id)).toEqual([logB.body.id, logA.body.id]);
    expect(list.body[0].rank_position).toBe(1);
    expect(list.body[1].rank_position).toBe(2);
  });

  it('converges correctly with 4 existing logs (even-sized binary search) and shifts all affected positions', async () => {
    const { token } = await createTestUser(app);
    const placeIds: string[] = [];
    const logIds: string[] = [];
    for (const name of ['A', 'B', 'C', 'D']) {
      const placeId = await createPlace(token, name);
      placeIds.push(placeId);
      const logRes = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });
      if (logRes.body.needs_ranking) {
        const resolved = await resolveRankingAlwaysWinning(app, token, placeId, logRes.body.id);
        logIds.push(resolved.id);
      } else {
        logIds.push(logRes.body.id);
      }
    }
    // Always-winning inserts each new log at the front, so order is D, C, B, A.
    const beforeList = await request(app).get('/logs').query({ category: 'restaurant' }).set('Authorization', `Bearer ${token}`);
    expect(beforeList.body.map((l: { place: { name: string } }) => l.place.name)).toEqual(['D', 'C', 'B', 'A']);

    // Now log a 5th place that always loses -> should land last, nothing else shifts.
    const placeE = await createPlace(token, 'E');
    const logE = await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeE });
    expect(logE.body.needs_ranking).toBe(true);

    let current = logE.body;
    for (;;) {
      const candidateRes = await request(app)
        .get('/logs/rank-candidates')
        .query({ place_id: placeE })
        .set('Authorization', `Bearer ${token}`);
      // The candidate wins this round: URL id = winner (candidate), body = loser (new log).
      const rankRes = await request(app)
        .post(`/logs/${candidateRes.body.candidate_log_id}/rank`)
        .set('Authorization', `Bearer ${token}`)
        .send({ won_against_log_id: current.id });
      current = rankRes.body;
      if (!current.needs_ranking) break;
    }
    expect(current.rank_position).toBe(5);

    const afterList = await request(app).get('/logs').query({ category: 'restaurant' }).set('Authorization', `Bearer ${token}`);
    expect(afterList.body.map((l: { place: { name: string } }) => l.place.name)).toEqual(['D', 'C', 'B', 'A', 'E']);
    expect(afterList.body.map((l: { rank_position: number }) => l.rank_position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rank-candidates returns 400 when there is no ranking in progress', async () => {
    const { token } = await createTestUser(app);
    const placeId = await createPlace(token, 'Solo Place');
    await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });

    const res = await request(app)
      .get('/logs/rank-candidates')
      .query({ place_id: placeId })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /logs', () => {
  it('rejects an invalid category', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).get('/logs').query({ category: 'nightclub' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns an empty list for a user with no logs', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).get('/logs').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
