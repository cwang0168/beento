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

async function createTrip(token: string, overrides: Partial<{ title: string; start_date: string; end_date: string }> = {}) {
  const res = await request(app)
    .post('/trips')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: overrides.title ?? 'Lisbon Trip',
      start_date: overrides.start_date ?? '2026-01-01',
      end_date: overrides.end_date ?? '2026-01-05',
    });
  return res.body;
}

describe('POST /trips', () => {
  it('creates a trip with title + date range only, no destination field', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Lisbon Trip', start_date: '2026-01-01', end_date: '2026-01-05' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Lisbon Trip' });
    expect(res.body).not.toHaveProperty('destination');
  });

  it('rejects start_date after end_date', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Bad Trip', start_date: '2026-01-05', end_date: '2026-01-01' });
    expect(res.status).toBe(400);
  });
});

describe('trip places (FR-22)', () => {
  it('adds and removes a place without touching an existing Log', async () => {
    const { token } = await createTestUser(app);
    const trip = await createTrip(token);
    const placeId = await createPlace(token, 'Time Out Market');

    await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeId });
    const addRes = await request(app)
      .post(`/trips/${trip.id}/places`)
      .set('Authorization', `Bearer ${token}`)
      .send({ place_id: placeId });
    expect(addRes.status).toBe(201);

    const getRes = await request(app).get(`/trips/${trip.id}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.body.places).toHaveLength(1);
    expect(getRes.body.places[0].status).toBe('visited');

    const removeRes = await request(app)
      .delete(`/trips/${trip.id}/places/${placeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removeRes.status).toBe(204);

    // Log survives the removal.
    expect(await prisma.log.count()).toBe(1);
    const afterRemove = await request(app).get(`/trips/${trip.id}`).set('Authorization', `Bearer ${token}`);
    expect(afterRemove.body.places).toHaveLength(0);
  });

  it('allows a place to sit in a trip with no Log against it yet (planned trip)', async () => {
    const { token } = await createTestUser(app);
    const trip = await createTrip(token);
    const placeId = await createPlace(token, 'Bar TBD');

    await request(app)
      .post(`/trips/${trip.id}/places`)
      .set('Authorization', `Bearer ${token}`)
      .send({ place_id: placeId });

    const getRes = await request(app).get(`/trips/${trip.id}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.body.places[0].status).toBe('none');
  });

  it("404s for another user's trip", async () => {
    const owner = await createTestUser(app);
    const other = await createTestUser(app);
    const trip = await createTrip(owner.token);
    const res = await request(app).get(`/trips/${trip.id}`).set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });
});

describe('post-trip prompt (FR-33, owner-only slice)', () => {
  it('400s before the trip has ended', async () => {
    const { token } = await createTestUser(app);
    const trip = await createTrip(token, { start_date: '2999-01-01', end_date: '2999-01-05' });
    const res = await request(app).get(`/trips/${trip.id}/prompt`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('lists only unlogged places once the trip has ended', async () => {
    const { token } = await createTestUser(app);
    const trip = await createTrip(token, { start_date: '2020-01-01', end_date: '2020-01-05' });
    const placeA = await createPlace(token, 'Logged Already');
    const placeB = await createPlace(token, 'Never Logged');
    await request(app).post('/logs').set('Authorization', `Bearer ${token}`).send({ place_id: placeA });
    await request(app).post(`/trips/${trip.id}/places`).set('Authorization', `Bearer ${token}`).send({ place_id: placeA });
    await request(app).post(`/trips/${trip.id}/places`).set('Authorization', `Bearer ${token}`).send({ place_id: placeB });

    const res = await request(app).get(`/trips/${trip.id}/prompt`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.places).toHaveLength(1);
    expect(res.body.places[0].name).toBe('Never Logged');
  });

  it('confirm-logs creates Logs for visited places and Saves for not-visited ones', async () => {
    const { token } = await createTestUser(app);
    const trip = await createTrip(token, { start_date: '2020-01-01', end_date: '2020-01-05' });
    const visited = await createPlace(token, 'Visited Place');
    const missed = await createPlace(token, 'Missed Place');

    const res = await request(app)
      .post(`/trips/${trip.id}/confirm-logs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ place_ids: [visited], not_visited_place_ids: [missed] });

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0]).toMatchObject({ place_id: visited, rank_position: 1 });
    expect(res.body.saves).toHaveLength(1);
    expect(res.body.saves[0]).toMatchObject({ place_id: missed });
  });

  it("404s the prompt for another user's trip", async () => {
    const owner = await createTestUser(app);
    const other = await createTestUser(app);
    const trip = await createTrip(owner.token, { start_date: '2020-01-01', end_date: '2020-01-05' });
    const res = await request(app).get(`/trips/${trip.id}/prompt`).set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });
});

describe('co-travelers (FR-24)', () => {
  it('is accepted immediately if the tagged user is already connected', async () => {
    const owner = await createTestUser(app);
    const friend = await createTestUser(app);
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });
    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ addressee_id: friendUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${friend.token}`);

    const trip = await createTrip(owner.token);
    const res = await request(app)
      .post(`/trips/${trip.id}/co-travelers`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ user_id: friendUser.id });
    expect(res.status).toBe(201);
    expect(res.body.invite_status).toBe('accepted');
  });

  it('is pending if the tagged user is not connected, and grants trip access once accepted', async () => {
    const owner = await createTestUser(app);
    const stranger = await createTestUser(app);
    const strangerUser = await prisma.user.findUniqueOrThrow({ where: { username: stranger.username } });
    const trip = await createTrip(owner.token);

    const tag = await request(app)
      .post(`/trips/${trip.id}/co-travelers`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ user_id: strangerUser.id });
    expect(tag.body.invite_status).toBe('pending');

    const deniedAccess = await request(app).get(`/trips/${trip.id}`).set('Authorization', `Bearer ${stranger.token}`);
    expect(deniedAccess.status).toBe(404);

    await prisma.tripCoTraveler.update({ where: { id: tag.body.id }, data: { inviteStatus: 'accepted' } });
    const grantedAccess = await request(app).get(`/trips/${trip.id}`).set('Authorization', `Bearer ${stranger.token}`);
    expect(grantedAccess.status).toBe(200);
  });

  it('supports an invited_email for a non-user', async () => {
    const owner = await createTestUser(app);
    const trip = await createTrip(owner.token);
    const res = await request(app)
      .post(`/trips/${trip.id}/co-travelers`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ invited_email: 'friend@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.invite_status).toBe('pending');
  });
});

describe('GET /trips/:id/comparison (FR-25)', () => {
  it('shows each accepted co-traveler ranking plus the group average', async () => {
    const owner = await createTestUser(app);
    const friend = await createTestUser(app);
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });
    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ addressee_id: friendUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${friend.token}`);

    const trip = await createTrip(owner.token);
    await request(app)
      .post(`/trips/${trip.id}/co-travelers`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ user_id: friendUser.id });

    const place = await createPlace(owner.token, 'Time Out Market');
    await request(app).post(`/trips/${trip.id}/places`).set('Authorization', `Bearer ${owner.token}`).send({ place_id: place });
    await request(app).post('/logs').set('Authorization', `Bearer ${owner.token}`).send({ place_id: place });
    await request(app).post('/logs').set('Authorization', `Bearer ${friend.token}`).send({ place_id: place });

    const res = await request(app).get(`/trips/${trip.id}/comparison`).set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.places).toHaveLength(1);
    expect(res.body.places[0].rankings).toHaveLength(2);
    expect(res.body.places[0].group_average).toBe(1);
  });
});

describe('GET /trips includes co-traveler trips', () => {
  it('lists owned trips with role owner and co-traveler trips with role co_traveler', async () => {
    const owner = await createTestUser(app);
    const friend = await createTestUser(app);
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });
    const connReq = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ addressee_id: friendUser.id });
    await request(app).post(`/connections/${connReq.body.id}/accept`).set('Authorization', `Bearer ${friend.token}`);

    const trip = await createTrip(owner.token);
    await request(app)
      .post(`/trips/${trip.id}/co-travelers`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ user_id: friendUser.id });

    const ownerList = await request(app).get('/trips').set('Authorization', `Bearer ${owner.token}`);
    expect(ownerList.body).toEqual([expect.objectContaining({ id: trip.id, role: 'owner' })]);

    const friendList = await request(app).get('/trips').set('Authorization', `Bearer ${friend.token}`);
    expect(friendList.body).toEqual([expect.objectContaining({ id: trip.id, role: 'co_traveler' })]);
  });

  it('does not list a trip for a pending (not yet accepted) co-traveler', async () => {
    const owner = await createTestUser(app);
    const stranger = await createTestUser(app);
    const strangerUser = await prisma.user.findUniqueOrThrow({ where: { username: stranger.username } });
    const trip = await createTrip(owner.token);
    await request(app)
      .post(`/trips/${trip.id}/co-travelers`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ user_id: strangerUser.id });

    const strangerList = await request(app).get('/trips').set('Authorization', `Bearer ${stranger.token}`);
    expect(strangerList.body).toEqual([]);
  });
});

describe('POST /trips/:id/prompt/notify (FR-33 remainder)', () => {
  it('notifies each accepted, account-holding co-traveler with unlogged places', async () => {
    const owner = await createTestUser(app);
    const friend = await createTestUser(app);
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });

    const trip = await createTrip(owner.token, { start_date: '2020-01-01', end_date: '2020-01-05' });
    await prisma.tripCoTraveler.create({
      data: { tripId: trip.id, userId: friendUser.id, inviteStatus: 'accepted' },
    });
    const place = await createPlace(owner.token, 'Time Out Market');
    await request(app).post(`/trips/${trip.id}/places`).set('Authorization', `Bearer ${owner.token}`).send({ place_id: place });

    const res = await request(app).post(`/trips/${trip.id}/prompt/notify`);
    expect(res.status).toBe(200);
    expect(res.body.notified).toEqual([{ user_id: friendUser.id, pending_place_count: 1 }]);
  });

  it('does not notify a lapsed (never-accepted) invitee', async () => {
    const owner = await createTestUser(app);
    const trip = await createTrip(owner.token, { start_date: '2020-01-01', end_date: '2020-01-05' });
    await prisma.tripCoTraveler.create({
      data: { tripId: trip.id, invitedEmail: 'lapsed@example.com', inviteStatus: 'pending' },
    });
    const place = await createPlace(owner.token, 'Time Out Market');
    await request(app).post(`/trips/${trip.id}/places`).set('Authorization', `Bearer ${owner.token}`).send({ place_id: place });

    const res = await request(app).post(`/trips/${trip.id}/prompt/notify`);
    expect(res.body.notified).toEqual([]);
  });
});
