process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { Role, User, Coach, SportCategory, TimeSlot, Booking, Payment } = require('../models');
require('./setup');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const register = (name, email, role) =>
  request(app).post('/api/auth/register').send({ name, email, password: 'Password1', role });

describe('Admin weekly payouts', () => {
  let adminToken;
  let clientToken;
  let coachA;
  let coachB;
  let client;
  let sport;
  let slotDay = 0;
  const ids = {};

  /** A paid, platform-held payment: coach keeps 90%. */
  async function paid(key, coach, amount, paidDaysAgo, { settled = false, provider = 'platform_qr', status = 'paid' } = {}) {
    slotDay += 1;
    const slot = await TimeSlot.create({ coachId: coach.id, date: `2099-06-${String(slotDay).padStart(2, '0')}`, startTime: '09:00', endTime: '10:00', status: 'booked' });
    const booking = await Booking.create({ clientId: client.id, coachId: coach.id, timeSlotId: slot.id, sportCategoryId: sport.id, price: amount, status: 'confirmed' });
    const payment = await Payment.create({
      bookingId: booking.id, amount, currency: 'php', provider, status,
      platformFeeAmount: amount * 0.1, payoutAmount: amount * 0.9, payoutSettled: settled,
      paidAt: status === 'paid' ? daysAgo(paidDaysAgo) : null,
    });
    ids[key] = payment.id;
  }

  beforeAll(async () => {
    await Role.bulkCreate([{ name: 'admin' }, { name: 'coach' }, { name: 'client' }]);
    sport = await SportCategory.create({ name: 'Tennis' });

    const a = await register('Alpha Coach', 'alpha-po@test.com', 'coach');
    coachA = await Coach.findOne({ where: { userId: a.body.data.user.id } });
    await coachA.update({ gcashNumber: '09171234567', gcashAccountName: 'A. Coach' });
    const b = await register('Bravo Coach', 'bravo-po@test.com', 'coach');
    coachB = await Coach.findOne({ where: { userId: b.body.data.user.id } });

    const c = await register('Client Po', 'client-po@test.com', 'client');
    clientToken = c.body.data.token;
    client = await User.findByPk(c.body.data.user.id);

    const adminRole = await Role.findOne({ where: { name: 'admin' } });
    await User.create({ name: 'Admin', email: 'admin-po@test.com', password: 'Password1', roleId: adminRole.id });
    adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin-po@test.com', password: 'Password1' })).body.data.token;

    // This week: A owes 900, A settled 450, B owes 270.
    await paid('a1', coachA, 1000, 0);
    await paid('a2', coachA, 500, 0, { settled: true });
    await paid('b1', coachB, 300, 0);
    // Last week: A owes 180.
    await paid('a3', coachA, 200, 7);
    // Three weeks ago: B settled 630.
    await paid('b2', coachB, 700, 21, { settled: true });
    // Never counted: money that went straight to the coach, and an unpaid QR.
    await paid('direct', coachA, 999, 0, { provider: 'gcash' });
    await paid('pending', coachB, 400, 0, { status: 'submitted' });
  });

  const weekly = (q = '') => request(app).get(`/api/admin/payouts/weekly${q}`).set('Authorization', `Bearer ${adminToken}`);
  const settle = (body) => request(app).put('/api/admin/payouts/settle').set('Authorization', `Bearer ${adminToken}`).send(body);

  it('is admin-only', async () => {
    expect((await request(app).get('/api/admin/payouts/weekly').set('Authorization', `Bearer ${clientToken}`)).status).toBe(403);
    expect((await request(app).put('/api/admin/payouts/settle').set('Authorization', `Bearer ${clientToken}`).send({ paymentIds: [ids.a1] })).status).toBe(403);
  });

  it('groups owed payouts into Monday-to-Sunday weeks, one line per coach', async () => {
    const res = await weekly();
    expect(res.status).toBe(200);
    const { status, summary, statements } = res.body.data;
    expect(status).toBe('owed');
    expect(summary).toMatchObject({ owed: 1350, settled: 1080, coachesOwed: 2 });
    expect(statements).toHaveLength(2);

    const [thisWeek, lastWeek] = statements;
    expect(new Date(`${thisWeek.weekStart}T00:00:00Z`).getUTCDay()).toBe(1); // Monday
    expect(thisWeek.weekEnd).toBe(new Date(new Date(`${thisWeek.weekStart}T00:00:00Z`).getTime() + 6 * DAY).toISOString().slice(0, 10));
    expect(summary.oldestOwedWeek).toBe(lastWeek.weekStart);
    expect(thisWeek).toMatchObject({ total: 1620, owed: 1170, settled: 450 });

    const [alpha, bravo] = thisWeek.coaches;
    expect(alpha).toMatchObject({
      name: 'Alpha Coach', gcashNumber: '09171234567', gcashAccountName: 'A. Coach',
      sessions: 2, gross: 1500, commission: 150, net: 1350, owed: 900, settled: 450, status: 'partial',
    });
    expect(alpha.items.map((i) => [i.net, i.settled])).toEqual(expect.arrayContaining([[900, false], [450, true]]));
    expect(alpha.items[0]).toMatchObject({ client: 'Client Po', startTime: '09:00' });
    expect(bravo).toMatchObject({ name: 'Bravo Coach', owed: 270, status: 'owed', gcashNumber: null });
    expect(lastWeek.coaches).toHaveLength(1);
    expect(lastWeek.coaches[0]).toMatchObject({ name: 'Alpha Coach', owed: 180 });
  });

  it('shows settled weeks and all weeks on request', async () => {
    const settled = (await weekly('?status=settled')).body.data.statements;
    expect(settled.map((w) => w.coaches.map((c) => [c.name, c.settled]))).toEqual([[['Alpha Coach', 450]], [['Bravo Coach', 630]]]);

    const all = (await weekly('?status=all&weeks=12')).body.data.statements;
    expect(all).toHaveLength(3);
    expect(all.reduce((s, w) => s + w.total, 0)).toBe(2430);
  });

  it('limits to recent weeks', async () => {
    const res = await weekly('?status=all&weeks=4');
    expect(res.body.data.weeks).toBe(4);
    expect(res.body.data.statements).toHaveLength(3); // 21 days ago is still within 4 weeks
    expect((await weekly('?weeks=99')).body.data.weeks).toBe('all');
  });

  it('settles a coach week in one call, and can undo it', async () => {
    const res = await settle({ paymentIds: [ids.a1, ids.a2] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ updated: 2, settled: true, amount: 1350 });

    let { summary, statements } = (await weekly()).body.data;
    expect(summary.owed).toBe(450);
    expect(statements[0].coaches.map((c) => c.name)).toEqual(['Bravo Coach']);

    await settle({ paymentIds: [ids.a1], settled: false });
    ({ summary } = (await weekly()).body.data);
    expect(summary.owed).toBe(1350);
  });

  it('rejects bad settle requests without changing anything', async () => {
    expect((await settle({ paymentIds: [] })).status).toBe(400);
    expect((await settle({ paymentIds: ['nope'] })).status).toBe(400);
    expect((await settle({ paymentIds: [ids.b1, '00000000-0000-4000-8000-000000000000'] })).status).toBe(404);
    expect((await settle({ paymentIds: [ids.b1, ids.pending] })).status).toBe(400);
    expect((await settle({ paymentIds: [ids.direct] })).status).toBe(400);
    expect((await Payment.findByPk(ids.b1)).payoutSettled).toBe(false);
  });
});
