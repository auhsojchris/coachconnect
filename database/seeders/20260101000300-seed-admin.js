const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Registration (POST /auth/register) only accepts role 'coach' or 'client'
// by design (see validators/auth.validator.js) — there is no public signup
// path to an admin account. This seeder bootstraps exactly one, so a fresh
// deployment always has a way in. Override ADMIN_EMAIL/ADMIN_PASSWORD in
// .env before seeding a real environment; change the password after first
// login either way.
module.exports = {
  up: async (queryInterface) => {
    const email = (process.env.ADMIN_EMAIL || 'admin@coachconnect.dev').toLowerCase().trim();

    const [existing] = await queryInterface.sequelize.query('SELECT id FROM users WHERE email = ?', {
      replacements: [email],
    });
    if (existing.length) return;

    const [roles] = await queryInterface.sequelize.query("SELECT id FROM roles WHERE name = 'admin' LIMIT 1");
    if (!roles.length) throw new Error('Admin role not found — run the roles seeder first (npm run seed)');

    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hashed = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
    const now = new Date();

    await queryInterface.bulkInsert('users', [
      {
        id: uuidv4(),
        name: 'admin',
        email,
        password: hashed,
        role_id: roles[0].id,
        is_active: true,
        email_verified: true,
        created_at: now,
        updated_at: now,
      },
    ]);
  },
  down: async (queryInterface) => {
    const email = (process.env.ADMIN_EMAIL || 'admin@coachconnect.dev').toLowerCase().trim();
    await queryInterface.bulkDelete('users', { email }, {});
  },
};
