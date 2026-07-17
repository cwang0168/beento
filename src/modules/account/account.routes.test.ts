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

describe('DELETE /me', () => {
  it('401s without an auth token', async () => {
    const res = await request(app).delete('/me').send({ password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('400s without a password', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).delete('/me').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('401s with the wrong password', async () => {
    const { token } = await createTestUser(app);
    const res = await request(app).delete('/me').set('Authorization', `Bearer ${token}`).send({ password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('deletes the account and everything it owns, preserving data owned by others', async () => {
    const owner = await createTestUser(app);
    const friend = await createTestUser(app);
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { username: owner.username } });
    const friendUser = await prisma.user.findUniqueOrThrow({ where: { username: friend.username } });

    // A place the owner created.
    const placeRes = await request(app)
      .post('/places')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Time Out Market', category: 'restaurant', lat: 38.7, lng: -9.1 });
    const placeId = placeRes.body.id as string;

    // A log and a save against it.
    await request(app).post('/logs').set('Authorization', `Bearer ${owner.token}`).send({ place_id: placeId });
    await request(app).post('/saves').set('Authorization', `Bearer ${owner.token}`).send({ place_id: placeId });

    // An accepted connection with the friend.
    const connRes = await request(app)
      .post('/connections')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ addressee_id: friendUser.id });
    await request(app).post(`/connections/${connRes.body.id}/accept`).set('Authorization', `Bearer ${friend.token}`);

    // A block in each direction, and a report in each direction.
    await request(app).post('/blocks').set('Authorization', `Bearer ${owner.token}`).send({ user_id: friendUser.id });
    await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ reported_user_id: friendUser.id, reason: 'spam' });
    await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${friend.token}`)
      .send({ reported_user_id: ownerUser.id, reason: 'harassment' });

    // A trip the owner owns, with the friend as an accepted co-traveler and a place on it.
    const tripRes = await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Lisbon Trip', start_date: '2026-01-01', end_date: '2026-01-05' });
    const tripId = tripRes.body.id as string;
    await request(app)
      .post(`/trips/${tripId}/places`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ place_id: placeId });
    await prisma.tripCoTraveler.create({
      data: { tripId, userId: friendUser.id, inviteStatus: 'accepted' },
    });

    // A second trip owned by the friend, where the owner (being deleted) is
    // just a co-traveler -- this trip must survive the owner's deletion.
    const friendTripRes = await request(app)
      .post('/trips')
      .set('Authorization', `Bearer ${friend.token}`)
      .send({ title: 'Porto Trip', start_date: '2026-02-01', end_date: '2026-02-05' });
    const friendTripId = friendTripRes.body.id as string;
    await prisma.tripCoTraveler.create({
      data: { tripId: friendTripId, userId: ownerUser.id, inviteStatus: 'accepted' },
    });

    const res = await request(app)
      .delete('/me')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ password: 'password123' });
    expect(res.status).toBe(204);

    expect(await prisma.user.findUnique({ where: { id: ownerUser.id } })).toBeNull();
    expect(await prisma.log.findMany({ where: { userId: ownerUser.id } })).toEqual([]);
    expect(await prisma.save.findMany({ where: { userId: ownerUser.id } })).toEqual([]);
    expect(await prisma.trip.findUnique({ where: { id: tripId } })).toBeNull();
    expect(await prisma.tripPlace.findMany({ where: { tripId } })).toEqual([]);
    expect(await prisma.tripCoTraveler.findMany({ where: { tripId } })).toEqual([]);
    expect(
      await prisma.connection.findMany({ where: { OR: [{ requesterId: ownerUser.id }, { addresseeId: ownerUser.id }] } }),
    ).toEqual([]);
    expect(
      await prisma.block.findMany({ where: { OR: [{ blockerId: ownerUser.id }, { blockedId: ownerUser.id }] } }),
    ).toEqual([]);
    expect(
      await prisma.report.findMany({ where: { OR: [{ reporterId: ownerUser.id }, { reportedUserId: ownerUser.id }] } }),
    ).toEqual([]);

    // The place the owner created is preserved (other users' Logs/Saves may
    // reference it), just orphaned.
    const survivingPlace = await prisma.place.findUnique({ where: { id: placeId } });
    expect(survivingPlace).not.toBeNull();
    expect(survivingPlace?.createdById).toBeNull();

    // The friend's trip survives; the deleted owner's co-traveler link on it is gone.
    expect(await prisma.trip.findUnique({ where: { id: friendTripId } })).not.toBeNull();
    expect(await prisma.tripCoTraveler.findMany({ where: { tripId: friendTripId } })).toEqual([]);
  });
});
