// Shared test setup: rebuilds the schema against the test database
// (config/config.js `test` entry -> `${DB_NAME}_test`) before each suite.
const { sequelize } = require('../models');

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.close();
});

module.exports = { sequelize };
