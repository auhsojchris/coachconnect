process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { Role, Coach, SportCategory, TimeSlot, Booking, Payment } = require('../models');
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
