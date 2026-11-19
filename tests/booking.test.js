process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { Role, User, Coach, SportCategory, TimeSlot } = require('../models');
require('./setup');

describe('Booking API — conflict prevention', () => {
  let clientTokenA;
  let clientTokenB;
  let coach;
  let sportCategory;
  let timeSlot;

  beforeAll(async () => {
    await Role.bulkCreate([{ name: 'admin' }, { name: 'coach' }, { name: 'client' }]);

    const coachUserRes = await request(app).post('/api/auth/register').send({
      name: 'Coach One',
      email: 'coach1@test.com',
      password: 'Password1',
      role: 'coach',
    });
    const coachUserId = coachUserRes.body.data.user.id;
    coach = await Coach.findOne({ where: { userId: coachUserId } });
    coach.hourlyRate = 50;
    await coach.save();

    sportCategory = await SportCategory.create({ name: 'Tennis' });

    timeSlot = await TimeSlot.create({
      coachId: coach.id,
      date: '2099-01-01',
      startTime: '10:00',
      endTime: '11:00',
      status: 'available',
    });

    const clientA = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Client A', email: 'clienta@test.com', password: 'Password1', role: 'client' });
    clientTokenA = clientA.body.data.token;

    const clientB = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Client B', email: 'clientb@test.com', password: 'Password1', role: 'client' });
    clientTokenB = clientB.body.data.token;
  });

  it('only allows one of two concurrent bookings for the same slot to succeed', async () => {
    const payload = { coachId: coach.id, timeSlotId: timeSlot.id, sportCategoryId: sportCategory.id };

    const [resA, resB] = await Promise.all([
      request(app).post('/api/bookings').set('Authorization', `Bearer ${clientTokenA}`).send(payload),
      request(app).post('/api/bookings').set('Authorization', `Bearer ${clientTokenB}`).send(payload),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const refreshedSlot = await TimeSlot.findByPk(timeSlot.id);
    expect(refreshedSlot.status).toBe('booked');
  });

  it('rejects booking an already-booked slot outright', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${clientTokenA}`)
      .send({ coachId: coach.id, timeSlotId: timeSlot.id, sportCategoryId: sportCategory.id });
    expect(res.status).toBe(409);
  });
});
