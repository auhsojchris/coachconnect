process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../app');
const { Role } = require('../models');
require('./setup');

describe('Auth API', () => {
  beforeAll(async () => {
    await Role.bulkCreate([{ name: 'admin' }, { name: 'coach' }, { name: 'client' }]);
  });

  const client = { name: 'Test Client', email: 'client@test.com', password: 'Password1', role: 'client' };

  it('registers a new client', async () => {
    const res = await request(app).post('/api/auth/register').send(client);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('rejects duplicate email registration', async () => {
    const res = await request(app).post('/api/auth/register').send(client);
    expect(res.status).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: client.email, password: client.password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: client.email, password: 'WrongPassword1' });
    expect(res.status).toBe(401);
  });

  it('rejects protected route without a token', async () => {
    const res = await request(app).get('/api/users/profile');
    expect(res.status).toBe(401);
  });
});
