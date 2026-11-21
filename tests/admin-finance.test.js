process.env.NODE_ENV = 'test';

const crypto = require('crypto');
const request = require('supertest');
const app = require('../app');
const { Role, User, Coach, SportCategory, TimeSlot, Booking, Payment } = require('../models');
require('./setup');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const register = (name, email, role) =>
  request(app).post('/api/auth/register').send({ name, email, password: 'Password1', role });

describe('Admin payments and commissions', () => {
  let adminToken;
  let clientToken;
  let coachA;
  let coachB;
  let clientOne;
  let clientTwo;
  let sport;
  let slotDay = 0;
  const ids = {};

  /** A payment for one session. 10% commission. */
  async function pay(key, coach, client, amount, { provider = 'platform_qr', status = 'paid', paidDaysAgo = 0, checkoutId = null, reference = null, feeSettled = false } = {}) {
    slotDay += 1;
    const slot = await TimeSlot.create({ coachId: coach.id, date: `2099-07-${String(slotDay).padStart(2, '0')}`, startTime: '08:00', endTime: '09:00', status: 'booked' });
    const booking = await Booking.create({ clientId: client.id, coachId: coach.id, timeSlotId: slot.id, sportCategoryId: sport.id, price: amount, status: 'confirmed', checkoutId });
    const p = await Payment.create({
      bookingId: booking.id, amount, currency: 'php', provider, status, gcashReference: reference,
      platformFeeAmount: amount * 0.1, platformFeeRate: 0.1, platformFeeSettled: feeSettled,
      payoutAmount: provider === 'gcash' ? null : amount * 0.9,
      paidAt: status === 'paid' ? daysAgo(paidDaysAgo) : null,
    });
    ids[key] = p.id;
  }

  beforeAll(async () => {
    await Role.bulkCreate([{ name: 'admin' }, { name: 'coach' }, { name: 'client' }]);
    sport = await SportCategory.create({ name: 'Boxing' });
    coachA = await Coach.findOne({ where: { userId: (await register('Alpha Coach', 'alpha-fi@test.com', 'coach')).body.data.user.id } });
    coachB = await Coach.findOne({ where: { userId: (await register('Bravo Coach', 'bravo-fi@test.com', 'coach')).body.data.user.id } });
    const c1 = await register('Carla Client', 'carla-fi@test.com', 'client');
    clientToken = c1.body.data.token;
    clientOne = await User.findByPk(c1.body.data.user.id);
    clientTwo = await User.findByPk((await register('Dan Client', 'dan-fi@test.com', 'client')).body.data.user.id);
    const adminRole = await Role.findOne({ where: { name: 'admin' } });
    await User.create({ name: 'Admin', email: 'admin-fi@test.com', password: 'Password1', roleId: adminRole.id });
    adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin-fi@test.com', password: 'Password1' })).body.data.token;

    // One QR checkout of two sessions with Alpha (today).
    const checkout = crypto.randomUUID();
    await pay('qr1', coachA, clientOne, 1000, { checkoutId: checkout, reference: 'REF-111' });
    await pay('qr2', coachA, clientOne, 1000, { checkoutId: checkout, reference: 'REF-111' });
    // Direct GCash to Bravo, 3 days ago: Bravo owes the 10%.
    await pay('g1', coachB, clientTwo, 500, { provider: 'gcash', paidDaysAgo: 3, reference: 'REF-222' });
    // Older direct GCash to Bravo, 40 days ago, commission already collected.
    await pay('g2', coachB, clientTwo, 800, { provider: 'gcash', paidDaysAgo: 40, feeSettled: true });
    // Not successful: never listed.
    await pay('wait', coachA, clientTwo, 999, { status: 'submitted', reference: 'REF-333' });
    await pay('bad', coachB, clientOne, 777, { status: 'failed' });
  });

  const get = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
  const settle = (body) => request(app).put('/api/admin/commissions/settle').set('Authorization', `Bearer ${adminToken}`).send(body);

  it('is admin-only', async () => {
    for (const path of ['/api/admin/payments', '/api/admin/commissions']) {
      expect((await request(app).get(path).set('Authorization', `Bearer ${clientToken}`)).status).toBe(403);
    }
  });

  describe('payments', () => {
    it('lists only successful payments, one row per checkout', async () => {
      const res = await get('/api/admin/payments');
      expect(res.status).toBe(200);
      const { summary, transactions } = res.body.data;
      expect(summary).toMatchObject({ transactions: 3, sessions: 4, amount: 3300, commission: 330 });
      expect(transactions.map((t) => [t.reference, t.sessions.length, t.amount])).toEqual([
        ['REF-111', 2, 2000],
        ['REF-222', 1, 500],
        [null, 1, 800],
      ]);
      expect(transactions[0]).toMatchObject({ method: 'platform_qr', client: { name: 'Carla Client' }, coach: { name: 'Alpha Coach' }, commission: 200 });
      expect(transactions[0].sessions[0]).toMatchObject({ startTime: '08:00', amount: 1000 });
      expect(summary.byMethod).toEqual([
        { method: 'platform_qr', transactions: 1, amount: 2000 },
        { method: 'gcash', transactions: 2, amount: 1300 },
      ]);
    });

    it('filters by period, method and search, and pages', async () => {
      expect((await get('/api/admin/payments?days=30')).body.data.summary.transactions).toBe(2);
      expect((await get('/api/admin/payments?method=gcash')).body.data.transactions.map((t) => t.amount)).toEqual([500, 800]);
      expect((await get('/api/admin/payments?search=ref-111')).body.data.transactions).toHaveLength(1);
      expect((await get('/api/admin/payments?search=bravo')).body.data.summary.transactions).toBe(2);
      const paged = await get('/api/admin/payments?limit=2&page=2');
      expect(paged.body.data.transactions).toHaveLength(1);
      expect(paged.body.meta).toMatchObject({ total: 3, page: 2, totalPages: 2 });
    });
  });

  describe('commissions', () => {
    it('groups every commission record by coach', async () => {
      const { summary, coaches } = (await get('/api/admin/commissions')).body.data;
      expect(summary).toMatchObject({ gross: 3300, commission: 330, collected: 280, owed: 50, coachesOwing: 1 });
      expect(coaches.map((c) => [c.name, c.sessions, c.commission, c.collected, c.owed])).toEqual([
        ['Bravo Coach', 2, 130, 80, 50],
        ['Alpha Coach', 2, 200, 200, 0],
      ]);
      const bravo = coaches[0];
      expect(bravo.records.map((r) => [r.amount, r.collected, r.heldByPlatform])).toEqual([[500, false, false], [800, true, false]]);
      expect(bravo.records[0]).toMatchObject({ client: 'Dan Client', method: 'gcash', rate: 0.1, commission: 50 });
      expect(coaches[1].records.every((r) => r.heldByPlatform && r.collected)).toBe(true);
    });

    it('filters to what is still owed, by period and by coach', async () => {
      const owed = (await get('/api/admin/commissions?status=owed')).body.data.coaches;
      expect(owed.map((c) => [c.name, c.records.length])).toEqual([['Bravo Coach', 1]]);
      expect((await get('/api/admin/commissions?days=30')).body.data.summary.commission).toBe(250);
      expect((await get('/api/admin/commissions?search=alpha')).body.data.coaches.map((c) => c.name)).toEqual(['Alpha Coach']);
    });

    it('marks direct GCash commissions collected in bulk, and undoes', async () => {
      const res = await settle({ paymentIds: [ids.g1] });
      expect(res.body.data).toMatchObject({ updated: 1, settled: true, amount: 50 });
      expect((await get('/api/admin/commissions')).body.data.summary).toMatchObject({ owed: 0, coachesOwing: 0 });
      await settle({ paymentIds: [ids.g1], settled: false });
      expect((await get('/api/admin/commissions')).body.data.summary.owed).toBe(50);
    });

    it('refuses to settle commissions the platform already kept', async () => {
      expect((await settle({ paymentIds: [ids.qr1] })).status).toBe(400);
      expect((await settle({ paymentIds: [] })).status).toBe(400);
      expect((await settle({ paymentIds: [ids.g1, '00000000-0000-4000-8000-000000000000'] })).status).toBe(404);
      expect((await Payment.findByPk(ids.g1)).platformFeeSettled).toBe(false);
    });
  });
});
