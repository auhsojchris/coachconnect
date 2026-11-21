process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { Role, User, Coach, SportCategory, TimeSlot, Court, Booking } = require('../models');
require('./setup');

describe('Courts', () => {
  let adminToken;
  let clientToken;
  let coach;
  let sport;
  let day = 0;

  const slot = async () => {
    day += 1;
    return TimeSlot.create({ coachId: coach.id, date: `2099-08-${String(day).padStart(2, '0')}`, startTime: '10:00', endTime: '11:00', status: 'available' });
  };
  const as = (token) => ({
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url, body) => request(app).put(url).set('Authorization', `Bearer ${token}`).send(body),
    del: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    await Role.bulkCreate([{ name: 'admin' }, { name: 'coach' }, { name: 'client' }]);
    sport = await SportCategory.create({ name: 'Badminton' });
    const c = await request(app).post('/api/auth/register').send({ name: 'Court Coach', email: 'coach-ct@test.com', password: 'Password1', role: 'coach' });
    coach = await Coach.findOne({ where: { userId: c.body.data.user.id } });
    await coach.update({ hourlyRate: 500 });
    clientToken = (await request(app).post('/api/auth/register').send({ name: 'Court Client', email: 'client-ct@test.com', password: 'Password1', role: 'client' })).body.data.token;
    const adminRole = await Role.findOne({ where: { name: 'admin' } });
    await User.create({ name: 'Admin', email: 'admin-ct@test.com', password: 'Password1', roleId: adminRole.id });
    adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin-ct@test.com', password: 'Password1' })).body.data.token;
  });

  it('books without a court while no courts are set up', async () => {
    const s = await slot();
    const res = await as(clientToken).post('/api/bookings', { coachId: coach.id, timeSlotId: s.id, sportCategoryId: sport.id });
    expect(res.status).toBe(201);
    expect(res.body.data.court).toBeNull();
  });

  describe('admin management', () => {
    it('is admin-only', async () => {
      expect((await as(clientToken).post('/api/courts', { name: 'Nope' })).status).toBe(403);
      expect((await as(clientToken).get('/api/courts/all')).status).toBe(403);
      expect((await request(app).post('/api/courts').send({ name: 'Nope' })).status).toBe(401);
    });

    it('creates, renames and validates courts', async () => {
      const created = await as(adminToken).post('/api/courts', { name: '  Rizal Court A ', address: 'Rizal Park, Manila' });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ name: 'Rizal Court A', address: 'Rizal Park, Manila', isActive: true });

      expect((await as(adminToken).post('/api/courts', { name: 'Rizal Court A' })).status).toBe(409);
      expect((await as(adminToken).post('/api/courts', { name: '   ' })).status).toBe(400);

      const other = await as(adminToken).post('/api/courts', { name: 'BGC Court 2' });
      expect((await as(adminToken).put(`/api/courts/${other.body.data.id}`, { name: 'Rizal Court A' })).status).toBe(409);
      const renamed = await as(adminToken).put(`/api/courts/${other.body.data.id}`, { name: 'BGC Court 1', address: '' });
      expect(renamed.body.data).toMatchObject({ name: 'BGC Court 1', address: null });
    });

    it('lists only active courts publicly, and everything with usage for admins', async () => {
      const bgc = await Court.findOne({ where: { name: 'BGC Court 1' } });
      await as(adminToken).put(`/api/courts/${bgc.id}`, { isActive: false });

      const pub = await request(app).get('/api/courts');
      expect(pub.status).toBe(200);
      expect(pub.body.data.map((c) => c.name)).toEqual(['Rizal Court A']);

      const all = await as(adminToken).get('/api/courts/all');
      expect(all.body.data.map((c) => [c.name, c.isActive, c.bookingCount])).toEqual([
        ['BGC Court 1', false, 0],
        ['Rizal Court A', true, 0],
      ]);
    });
  });

  describe('booking with courts set up', () => {
    it('requires a court', async () => {
      const s = await slot();
      const res = await as(clientToken).post('/api/bookings', { coachId: coach.id, timeSlotId: s.id, sportCategoryId: sport.id });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/court/i);
      expect((await TimeSlot.findByPk(s.id)).status).toBe('available'); // nothing booked
    });

    it('rejects an inactive or unknown court', async () => {
      const bgc = await Court.findOne({ where: { name: 'BGC Court 1' } });
      const s = await slot();
      expect((await as(clientToken).post('/api/bookings', { coachId: coach.id, timeSlotId: s.id, sportCategoryId: sport.id, courtId: bgc.id })).status).toBe(400);
      expect((await as(clientToken).post('/api/bookings', { coachId: coach.id, timeSlotId: s.id, sportCategoryId: sport.id, courtId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
      expect((await as(clientToken).post('/api/bookings', { coachId: coach.id, timeSlotId: s.id, sportCategoryId: sport.id, courtId: 'nope' })).status).toBe(400);
    });

    it('saves the court on every session in a multi-session checkout', async () => {
      const rizal = await Court.findOne({ where: { name: 'Rizal Court A' } });
      const [a, b] = [await slot(), await slot()];
      const res = await as(clientToken).post('/api/bookings/batch', { coachId: coach.id, timeSlotIds: [a.id, b.id], sportCategoryId: sport.id, courtId: rizal.id });
      expect(res.status).toBe(201);
      expect(res.body.data.bookings.map((x) => x.court && x.court.name)).toEqual(['Rizal Court A', 'Rizal Court A']);

      const list = await as(clientToken).get('/api/bookings');
      expect(list.body.data.filter((x) => x.court && x.court.name === 'Rizal Court A')).toHaveLength(2);
    });
  });

  describe('deleting', () => {
    it('refuses to delete a court that has bookings', async () => {
      const rizal = await Court.findOne({ where: { name: 'Rizal Court A' } });
      const res = await as(adminToken).del(`/api/courts/${rizal.id}`);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/2 bookings.*Deactivate/);
      expect((await as(adminToken).get('/api/courts/all')).body.data.find((c) => c.id === rizal.id).bookingCount).toBe(2);
    });

    it('deletes an unused court', async () => {
      const bgc = await Court.findOne({ where: { name: 'BGC Court 1' } });
      expect((await as(adminToken).del(`/api/courts/${bgc.id}`)).status).toBe(200);
      expect(await Court.findByPk(bgc.id)).toBeNull();
      expect((await as(adminToken).del(`/api/courts/${bgc.id}`)).status).toBe(404);
      expect(await Booking.count({ where: { courtId: null } })).toBe(1); // the pre-courts booking is untouched
    });
  });
});
