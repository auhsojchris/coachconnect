process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { Role, User, Coach, SportCategory, TimeSlot, Booking, Payment } = require('../models');
require('./setup');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const register = (name, email, role) =>
  request(app).post('/api/auth/register').send({ name, email, password: 'Password1', role });

describe('Admin overview analytics', () => {
  let adminToken;
  let clientToken;
  let coachA;
  let coachB;
  let client;
  let sport;
  let slotDay = 0;

  /** A booking + payment, paid `paidDaysAgo` days ago (null = not paid). */
  async function sale(coach, amount, { paidDaysAgo = null, status = 'confirmed', provider = 'platform_qr', paymentStatus = 'paid', fee = 0 } = {}) {
    slotDay += 1;
    const slot = await TimeSlot.create({ coachId: coach.id, date: `2099-05-${String(slotDay).padStart(2, '0')}`, startTime: '09:00', endTime: '10:00', status: 'booked' });
    const booking = await Booking.create({ clientId: client.id, coachId: coach.id, timeSlotId: slot.id, sportCategoryId: sport.id, price: amount, status });
    if (paidDaysAgo !== null || paymentStatus !== 'paid') {
      await Payment.create({
        bookingId: booking.id, amount, currency: 'php', provider, status: paymentStatus,
        platformFeeAmount: fee, paidAt: paidDaysAgo === null ? null : daysAgo(paidDaysAgo),
      });
    }
    return booking;
  }

  beforeAll(async () => {
    await Role.bulkCreate([{ name: 'admin' }, { name: 'coach' }, { name: 'client' }]);
    sport = await SportCategory.create({ name: 'Swimming' });

    const a = await register('Alpha Coach', 'alpha@test.com', 'coach');
    coachA = await Coach.findOne({ where: { userId: a.body.data.user.id } });
    await coachA.update({ isVerified: true });
    const b = await register('Bravo Coach', 'bravo@test.com', 'coach');
    coachB = await Coach.findOne({ where: { userId: b.body.data.user.id } }); // unverified

    const c = await register('Client One', 'client-ov@test.com', 'client');
    clientToken = c.body.data.token;
    client = await User.findByPk(c.body.data.user.id);

    const adminRole = await Role.findOne({ where: { name: 'admin' } });
    await User.create({ name: 'Admin', email: 'admin-ov@test.com', password: 'Password1', roleId: adminRole.id });
    adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin-ov@test.com', password: 'Password1' })).body.data.token;

    // Last 7 days: A 1000 + 500, B 300. Days 8-13 (previous 7-day window): A 200.
    await sale(coachA, 1000, { paidDaysAgo: 1, fee: 100 });
    await sale(coachA, 500, { paidDaysAgo: 0, fee: 50 });
    await sale(coachB, 300, { paidDaysAgo: 3, fee: 30 });
    await sale(coachA, 200, { paidDaysAgo: 10, fee: 20 });
    // Day 40: outside both 7-day windows, inside 90.
    await sale(coachB, 700, { paidDaysAgo: 40, fee: 70 });
    // Waiting on an admin: 2 QR submissions totalling 450.
    await sale(coachA, 250, { status: 'pending', paymentStatus: 'submitted' });
    await sale(coachB, 200, { status: 'pending', paymentStatus: 'submitted' });
  });

  const stats = (range) =>
    request(app).get(`/api/admin/dashboard/stats${range ? `?range=${range}` : ''}`).set('Authorization', `Bearer ${adminToken}`);

  it('is admin-only', async () => {
    const res = await request(app).get('/api/admin/dashboard/stats').set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });

  it('totals the selected period and the period before it', async () => {
    const res = await stats(7);
    expect(res.status).toBe(200);
    const { overview } = res.body.data;
    expect(overview.range).toBe(7);
    expect(overview.current.revenue).toBe(1800);
    expect(overview.current.commission).toBe(180);
    expect(overview.previous.revenue).toBe(200);
    expect(overview.previous.commission).toBe(20);
    // All 7 bookings and all 3 sign-ups happened today.
    expect(overview.current.bookings).toBe(7);
    expect(overview.current.newClients).toBe(1);
    expect(overview.current.newCoaches).toBe(2);
    expect(overview.previous.bookings).toBe(0);
  });

  it('returns one trend bucket per day for 7 days, summing to the period revenue', async () => {
    const { overview } = (await stats(7)).body.data;
    expect(overview.trend).toHaveLength(7);
    expect(overview.trend.reduce((s, t) => s + t.revenue, 0)).toBe(1800);
    expect(overview.trend[6].revenue).toBe(500); // today
    expect(overview.trend[5].revenue).toBe(1000); // yesterday
    expect(overview.trend[6].bookings).toBe(7);
  });

  it('uses weekly buckets for 90 days and includes older sales', async () => {
    const { overview } = (await stats(90)).body.data;
    expect(overview.trend).toHaveLength(13);
    expect(overview.trend.every((t, i) => t.days === (i < 12 ? 7 : 6))).toBe(true);
    expect(overview.current.revenue).toBe(2700);
  });

  it('ranks top coaches by revenue in the period', async () => {
    const { overview } = (await stats(7)).body.data;
    expect(overview.topCoaches.map((c) => [c.name, c.revenue, c.sessions])).toEqual([
      ['Alpha Coach', 1500, 2],
      ['Bravo Coach', 300, 1],
    ]);
  });

  it('counts what needs an admin and verified coaches', async () => {
    const { data } = (await stats()).body;
    expect(data.overview.range).toBe(30); // default
    expect(data.overview.attention).toEqual({ qrPaymentsToVerify: 2, qrAmountToVerify: 450, unverifiedCoaches: 1 });
    expect(data.verifiedCoaches).toBe(1);
    expect(data.totalCoaches).toBe(2);
  });

  it('falls back to 30 days for an unsupported range', async () => {
    expect((await stats(365)).body.data.overview.range).toBe(30);
  });

  it('includes who and when on recent bookings', async () => {
    const { recentBookings } = (await stats()).body.data;
    expect(recentBookings).toHaveLength(7);
    expect(recentBookings[0].client.name).toBe('Client One');
    expect(recentBookings[0].coach.user.name).toMatch(/Coach$/);
    expect(recentBookings[0].timeSlot.date).toMatch(/^2099-05-/);
  });
});
