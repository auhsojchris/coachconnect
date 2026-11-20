process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { Role, User, Coach, SportCategory, TimeSlot, Booking, Payment, Notification } = require('../models');
require('./setup');

describe('Multi-session checkout', () => {
  let clientToken;
  let coachToken;
  let coach;
  let sport;
  const slots = [];

  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const register = (name, email, role) =>
    request(app).post('/api/auth/register').send({ name, email, password: 'Password1', role });

  beforeAll(async () => {
    await Role.bulkCreate([{ name: 'admin' }, { name: 'coach' }, { name: 'client' }]);

    const coachRes = await register('Coach Multi', 'coach-multi@test.com', 'coach');
    coachToken = coachRes.body.data.token;
    coach = await Coach.findOne({ where: { userId: coachRes.body.data.user.id } });
    await coach.update({ hourlyRate: 500, gcashNumber: '09170000000', gcashAccountName: 'Coach Multi' });

    sport = await SportCategory.create({ name: 'Badminton' });
    for (const [date, start, end] of [
      ['2099-02-01', '09:00', '10:00'],
      ['2099-02-01', '10:00', '11:30'], // 1.5h -> 750
      ['2099-02-02', '09:00', '10:00'],
      ['2099-02-03', '09:00', '10:00'],
      ['2099-02-04', '09:00', '10:00'],
    ]) {
      slots.push(await TimeSlot.create({ coachId: coach.id, date, startTime: start, endTime: end, status: 'available' }));
    }

    clientToken = (await register('Client Multi', 'client-multi@test.com', 'client')).body.data.token;
  });

  let checkoutBookings;

  it('books several slots at once under one checkout with a combined total', async () => {
    const res = await request(app)
      .post('/api/bookings/batch')
      .set(auth(clientToken))
      .send({ coachId: coach.id, sportCategoryId: sport.id, timeSlotIds: [slots[0].id, slots[1].id, slots[2].id] });

    expect(res.status).toBe(201);
    expect(res.body.data.bookings).toHaveLength(3);
    expect(res.body.data.total).toBe(500 + 750 + 500);
    const ids = new Set(res.body.data.bookings.map((b) => b.checkoutId));
    expect(ids.size).toBe(1);
    expect(res.body.data.checkoutId).toBeTruthy();
    checkoutBookings = res.body.data.bookings;
  });

  it('is all-or-nothing: one unavailable slot books none of them', async () => {
    const res = await request(app)
      .post('/api/bookings/batch')
      .set(auth(clientToken))
      .send({ coachId: coach.id, sportCategoryId: sport.id, timeSlotIds: [slots[3].id, slots[0].id] }); // slots[0] already booked

    expect(res.status).toBe(409);
    expect((await TimeSlot.findByPk(slots[3].id)).status).toBe('available');
    expect(await Booking.count({ where: { timeSlotId: slots[3].id } })).toBe(0);
  });

  it('rejects more than 10 slots and an empty list', async () => {
    const tooMany = Array.from({ length: 11 }, () => slots[3].id);
    const res1 = await request(app).post('/api/bookings/batch').set(auth(clientToken)).send({ coachId: coach.id, sportCategoryId: sport.id, timeSlotIds: tooMany });
    const res2 = await request(app).post('/api/bookings/batch').set(auth(clientToken)).send({ coachId: coach.id, sportCategoryId: sport.id, timeSlotIds: [] });
    expect(res1.status).toBe(400);
    expect(res2.status).toBe(400);
  });

  it('drops sessions cancelled before payment from the checkout total', async () => {
    const cancelled = checkoutBookings.find((b) => b.timeSlotId === slots[2].id);
    const cancelRes = await request(app).post(`/api/bookings/${cancelled.id}/cancel`).set(auth(clientToken)).send({});
    expect(cancelRes.status).toBe(200);

    const info = await request(app).get(`/api/payments/gcash-info/${checkoutBookings[0].id}`).set(auth(clientToken));
    expect(info.status).toBe(200);
    expect(info.body.data.amount).toBe(500 + 750);
    expect(info.body.data.sessionCount).toBe(2);
  });

  it('one GCash submission covers every session; coach confirms them all at once', async () => {
    const submit = await request(app)
      .post('/api/payments/gcash')
      .set(auth(clientToken))
      .send({ bookingId: checkoutBookings[0].id, referenceNumber: 'REF-MULTI-1' });
    expect(submit.status).toBe(201);

    const live = checkoutBookings.filter((b) => b.timeSlotId !== slots[2].id).map((b) => b.id);
    const payments = await Payment.findAll({ where: { bookingId: live } });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.status === 'submitted' && p.gcashReference === 'REF-MULTI-1' && p.currency === 'php')).toBe(true);
    // Per-session commission is kept: 10% of 500 and of 750.
    expect(payments.map((p) => Number(p.platformFeeAmount)).sort((a, b) => a - b)).toEqual([50, 75]);

    const confirm = await request(app).put(`/api/payments/${payments[0].id}/confirm-gcash`).set(auth(coachToken));
    expect(confirm.status).toBe(200);

    const after = await Booking.findAll({ where: { id: live }, include: [{ model: Payment, as: 'payment' }] });
    expect(after.every((b) => b.status === 'confirmed' && b.payment.status === 'paid')).toBe(true);
    // The cancelled one stays cancelled and unpaid.
    const cancelled = await Booking.findOne({ where: { timeSlotId: slots[2].id } });
    expect(cancelled.status).toBe('cancelled');
    expect(await Payment.count({ where: { bookingId: cancelled.id } })).toBe(0);
  });

  it('lets a slot freed by a cancellation be booked again', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set(auth(clientToken))
      .send({ coachId: coach.id, sportCategoryId: sport.id, timeSlotId: slots[2].id });
    expect(res.status).toBe(201);
    expect(res.body.data.checkoutId).toBeNull();
    expect(await Booking.count({ where: { timeSlotId: slots[2].id } })).toBe(2);
  });

  it('a single booking still pays only for itself', async () => {
    const res = await request(app)
      .post('/api/bookings/batch')
      .set(auth(clientToken))
      .send({ coachId: coach.id, sportCategoryId: sport.id, timeSlotIds: [slots[4].id] });
    expect(res.status).toBe(201);
    expect(res.body.data.checkoutId).toBeNull();

    const info = await request(app).get(`/api/payments/gcash-info/${res.body.data.bookings[0].id}`).set(auth(clientToken));
    expect(info.body.data.amount).toBe(500);
    expect(info.body.data.sessionCount).toBe(1);
  });
});

describe('Paying for separately-booked sessions together', () => {
  let clientToken;
  let coachToken;
  let coachA;
  let coachB;
  let sport;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const register = (name, email, role) =>
    request(app).post('/api/auth/register').send({ name, email, password: 'Password1', role });
  const bookOne = async (coach, date) => {
    const slot = await TimeSlot.create({ coachId: coach.id, date, startTime: '08:00', endTime: '09:00', status: 'available' });
    const res = await request(app).post('/api/bookings').set(auth(clientToken)).send({ coachId: coach.id, timeSlotId: slot.id, sportCategoryId: sport.id });
    expect(res.status).toBe(201);
    return res.body.data;
  };

  beforeAll(async () => {
    const a = await register('Coach A', 'coach-a@test.com', 'coach');
    coachToken = a.body.data.token;
    coachA = await Coach.findOne({ where: { userId: a.body.data.user.id } });
    await coachA.update({ hourlyRate: 400, gcashNumber: '09171111111' });
    const b = await register('Coach B', 'coach-b@test.com', 'coach');
    coachB = await Coach.findOne({ where: { userId: b.body.data.user.id } });
    await coachB.update({ hourlyRate: 300, gcashNumber: '09172222222' });
    sport = await SportCategory.create({ name: 'Pickleball' });
    clientToken = (await register('Client Sep', 'client-sep@test.com', 'client')).body.data.token;
  });

  it('adds up chosen unpaid sessions and confirms them all with one GCash payment', async () => {
    const b1 = await bookOne(coachA, '2099-03-01');
    const b2 = await bookOne(coachA, '2099-03-02');
    const b3 = await bookOne(coachA, '2099-03-03');
    expect([b1, b2, b3].every((b) => b.checkoutId === null)).toBe(true);

    // Reading the total for a subset doesn't change anything.
    const info = await request(app).get(`/api/payments/gcash-info/${b1.id}?bookingIds=${b1.id},${b3.id}`).set(auth(clientToken));
    expect(info.status).toBe(200);
    expect(info.body.data.amount).toBe(800);
    expect(info.body.data.sessionCount).toBe(2);
    expect((await Booking.findByPk(b1.id)).checkoutId).toBeNull();

    const submit = await request(app).post('/api/payments/gcash').set(auth(clientToken)).send({ bookingIds: [b1.id, b3.id], referenceNumber: 'REF-SEP-1' });
    expect(submit.status).toBe(201);

    const [r1, r2, r3] = await Promise.all([b1, b2, b3].map((b) => Booking.findByPk(b.id, { include: [{ model: Payment, as: 'payment' }] })));
    expect(r1.checkoutId).toBeTruthy();
    expect(r3.checkoutId).toBe(r1.checkoutId);
    expect(r2.checkoutId).toBeNull();
    expect(r2.payment).toBeNull();

    const confirm = await request(app).put(`/api/payments/${r3.payment.id}/confirm-gcash`).set(auth(coachToken));
    expect(confirm.status).toBe(200);
    const after = await Booking.findAll({ where: { id: [b1.id, b2.id, b3.id] }, include: [{ model: Payment, as: 'payment' }] });
    const byId = Object.fromEntries(after.map((b) => [b.id, b]));
    expect(byId[b1.id].status).toBe('confirmed');
    expect(byId[b3.id].status).toBe('confirmed');
    expect(byId[b2.id].status).toBe('pending'); // not selected, still unpaid
  });

  it('refuses to combine sessions with different coaches', async () => {
    const a = await bookOne(coachA, '2099-04-01');
    const b = await bookOne(coachB, '2099-04-01');
    const res = await request(app).post('/api/payments/gcash').set(auth(clientToken)).send({ bookingIds: [a.id, b.id], referenceNumber: 'REF-MIX' });
    expect(res.status).toBe(400);
    expect(await Payment.count({ where: { bookingId: [a.id, b.id] } })).toBe(0);
  });

  it("rejects paying for someone else's booking or a malformed list", async () => {
    const mine = await bookOne(coachA, '2099-05-01');
    const otherToken = (await register('Other Client', 'other-sep@test.com', 'client')).body.data.token;
    const res1 = await request(app).post('/api/payments/gcash').set(auth(otherToken)).send({ bookingIds: [mine.id], referenceNumber: 'X' });
    expect(res1.status).toBe(403);
    const res2 = await request(app).post('/api/payments/gcash').set(auth(clientToken)).send({ bookingIds: ['not-a-uuid'], referenceNumber: 'X' });
    expect(res2.status).toBe(400);
    const res3 = await request(app).get(`/api/payments/gcash-info/${mine.id}?bookingIds=nope`).set(auth(clientToken));
    expect(res3.status).toBe(400);
  });
});

describe('Platform QR checkout', () => {
  let clientToken;
  let coachToken;
  let adminToken;
  let admin;
  let coach;
  let sport;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const register = (name, email, role) =>
    request(app).post('/api/auth/register').send({ name, email, password: 'Password1', role });
  const bookOne = async (date) => {
    const slot = await TimeSlot.create({ coachId: coach.id, date, startTime: '07:00', endTime: '08:00', status: 'available' });
    const res = await request(app).post('/api/bookings').set(auth(clientToken)).send({ coachId: coach.id, timeSlotId: slot.id, sportCategoryId: sport.id });
    expect(res.status).toBe(201);
    return res.body.data;
  };

  beforeAll(async () => {
    const adminRole = await Role.findOne({ where: { name: 'admin' } });
    admin = await User.create({ name: 'Platform Admin', email: 'admin-qr@test.com', password: 'Password1', roleId: adminRole.id });
    adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin-qr@test.com', password: 'Password1' })).body.data.token;

    const c = await register('Coach QR', 'coach-qr@test.com', 'coach');
    coachToken = c.body.data.token;
    coach = await Coach.findOne({ where: { userId: c.body.data.user.id } });
    await coach.update({ hourlyRate: 500 });
    sport = await SportCategory.create({ name: 'Tennis QR' });
    clientToken = (await register('Client QR', 'client-qr@test.com', 'client')).body.data.token;
  });

  it('reports not configured until an admin has a QR, then returns where and how much to pay', async () => {
    const b1 = await bookOne('2099-06-01');
    const b2 = await bookOne('2099-06-02');
    const before = await request(app).get(`/api/payments/qr-checkout/${b1.id}?bookingIds=${b1.id},${b2.id}`).set(auth(clientToken));
    expect(before.status).toBe(200);
    expect(before.body.data.configured).toBe(false);

    await admin.update({ gcashQrUrl: 'https://example.com/qr.png', gcashNumber: '09050000000', gcashAccountName: 'Platform' });
    const after = await request(app).get(`/api/payments/qr-checkout/${b1.id}?bookingIds=${b1.id},${b2.id}`).set(auth(clientToken));
    expect(after.body.data).toMatchObject({ configured: true, amount: 1000, sessionCount: 2, qrUrl: 'https://example.com/qr.png', accountName: 'Platform' });
  });

  it('records a submitted QR payment for every session and alerts the admin; only an admin can confirm it', async () => {
    const b1 = await bookOne('2099-07-01');
    const b2 = await bookOne('2099-07-02');
    const submit = await request(app).post('/api/payments/qr').set(auth(clientToken)).send({ bookingIds: [b1.id, b2.id], referenceNumber: '1234 567 890' });
    expect(submit.status).toBe(201);
    expect(submit.body.data.total).toBe(1000);

    const payments = await Payment.findAll({ where: { bookingId: [b1.id, b2.id] } });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.provider === 'platform_qr' && p.status === 'submitted' && Number(p.payoutAmount) === 450 && p.currency === 'php')).toBe(true);
    expect(await Notification.count({ where: { userId: admin.id, type: 'payment_submitted' } })).toBe(1);

    const list = await request(app).get('/api/admin/qr-payments').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.filter((p) => [b1.id, b2.id].includes(p.bookingId))).toHaveLength(2);

    const coachTry = await request(app).put(`/api/payments/${payments[0].id}/confirm-gcash`).set(auth(coachToken));
    expect(coachTry.status).toBe(403);

    const confirm = await request(app).put(`/api/payments/${payments[0].id}/confirm-gcash`).set(auth(adminToken));
    expect(confirm.status).toBe(200);
    const after = await Booking.findAll({ where: { id: [b1.id, b2.id] }, include: [{ model: Payment, as: 'payment' }] });
    expect(after.every((b) => b.status === 'confirmed' && b.payment.status === 'paid' && b.payment.payoutSettled === false)).toBe(true);
    expect(await Notification.count({ where: { userId: coach.userId, type: 'payout_pending' } })).toBe(1);

    const payouts = await request(app).get('/api/admin/gcash-payouts?settled=false').set(auth(adminToken));
    expect(payouts.body.data.some((p) => p.bookingId === b1.id)).toBe(true);
  });

  it('rejects a reference number already used for another payment', async () => {
    const b = await bookOne('2099-08-01');
    const res = await request(app).post('/api/payments/qr').set(auth(clientToken)).send({ bookingIds: [b.id], referenceNumber: '1234 567 890' });
    expect(res.status).toBe(409);
    expect(await Payment.count({ where: { bookingId: b.id } })).toBe(0);
  });

  it('rejecting puts every session back to payable', async () => {
    const b1 = await bookOne('2099-09-01');
    const b2 = await bookOne('2099-09-02');
    await request(app).post('/api/payments/qr').set(auth(clientToken)).send({ bookingIds: [b1.id, b2.id], referenceNumber: 'BAD-REF-1' });
    const p = await Payment.findOne({ where: { bookingId: b1.id } });
    const res = await request(app).put(`/api/payments/${p.id}/reject-gcash`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const after = await Booking.findAll({ where: { id: [b1.id, b2.id] }, include: [{ model: Payment, as: 'payment' }] });
    expect(after.every((b) => b.status === 'pending' && b.payment.status === 'failed')).toBe(true);
  });
});
