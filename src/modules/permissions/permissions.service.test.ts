import { prisma } from '../../prisma';
import { resetDatabase } from '../../test/db';
import { canView } from './permissions.service';

async function makeUser(email: string, profilePublic = false) {
  return prisma.user.create({
    data: { email, passwordHash: 'x', displayName: email, username: email.split('@')[0], profilePublic },
  });
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('canView', () => {
  it('always allows a user to view their own content', async () => {
    const a = await makeUser('a@example.com');
    expect(await canView(a.id, a.id, 'past_content')).toBe(true);
    expect(await canView(a.id, a.id, 'future_trip')).toBe(true);
    expect(await canView(a.id, a.id, 'save')).toBe(true);
  });

  it('profile_identity is always visible regardless of connection state', async () => {
    const a = await makeUser('a@example.com');
    const b = await makeUser('b@example.com');
    expect(await canView(a.id, b.id, 'profile_identity')).toBe(true);
  });

  describe('no connection', () => {
    it('private profile: denies past_content, future_trip, save', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', false);
      expect(await canView(a.id, b.id, 'past_content')).toBe(false);
      expect(await canView(a.id, b.id, 'future_trip')).toBe(false);
      expect(await canView(a.id, b.id, 'save')).toBe(false);
    });

    it('public profile: allows past_content only, denies future_trip and save (NFR-4d)', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', true);
      expect(await canView(a.id, b.id, 'past_content')).toBe(true);
      expect(await canView(a.id, b.id, 'future_trip')).toBe(false);
      expect(await canView(a.id, b.id, 'save')).toBe(false);
    });
  });

  describe('pending connection', () => {
    it('behaves identically to no connection (private)', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', false);
      await prisma.connection.create({ data: { requesterId: a.id, addresseeId: b.id, status: 'pending' } });
      expect(await canView(a.id, b.id, 'past_content')).toBe(false);
      expect(await canView(a.id, b.id, 'future_trip')).toBe(false);
    });

    it('behaves identically to no connection (public: past_content only)', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', true);
      await prisma.connection.create({ data: { requesterId: a.id, addresseeId: b.id, status: 'pending' } });
      expect(await canView(a.id, b.id, 'past_content')).toBe(true);
      expect(await canView(a.id, b.id, 'future_trip')).toBe(false);
    });
  });

  describe('accepted connection', () => {
    it('private profile: grants everything (NFR-4f total grant)', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', false);
      await prisma.connection.create({ data: { requesterId: a.id, addresseeId: b.id, status: 'accepted' } });
      expect(await canView(a.id, b.id, 'past_content')).toBe(true);
      expect(await canView(a.id, b.id, 'future_trip')).toBe(true);
      expect(await canView(a.id, b.id, 'save')).toBe(true);
    });

    it('public profile: grants everything too, including future_trip/save (connection supersedes NFR-4d)', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', true);
      await prisma.connection.create({ data: { requesterId: a.id, addresseeId: b.id, status: 'accepted' } });
      expect(await canView(a.id, b.id, 'past_content')).toBe(true);
      expect(await canView(a.id, b.id, 'future_trip')).toBe(true);
      expect(await canView(a.id, b.id, 'save')).toBe(true);
    });

    it('is symmetric regardless of who requested', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', false);
      await prisma.connection.create({ data: { requesterId: b.id, addresseeId: a.id, status: 'accepted' } });
      expect(await canView(a.id, b.id, 'past_content')).toBe(true);
    });
  });

  describe('block', () => {
    it('denies everything even with an accepted connection somehow present', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', true);
      await prisma.connection.create({ data: { requesterId: a.id, addresseeId: b.id, status: 'accepted' } });
      await prisma.block.create({ data: { blockerId: b.id, blockedId: a.id } });
      expect(await canView(a.id, b.id, 'past_content')).toBe(false);
      expect(await canView(a.id, b.id, 'profile_identity')).toBe(false);
    });

    it('denies in both directions regardless of who blocked whom', async () => {
      const a = await makeUser('a@example.com');
      const b = await makeUser('b@example.com', true);
      await prisma.block.create({ data: { blockerId: a.id, blockedId: b.id } });
      expect(await canView(b.id, a.id, 'past_content')).toBe(false);
    });
  });
});
