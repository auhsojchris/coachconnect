const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const config = require('./config')[process.env.NODE_ENV || 'development'];

// Sequelize loads dialect drivers with a dynamically computed require() path,
// which Vercel's build-time dependency tracing can't follow, so pg silently
// gets left out of the deployed bundle unless it's required directly here.
if (config.dialect === 'postgres') {
  require('pg');
}

const commonOptions = {
  dialect: config.dialect,
  dialectOptions: config.dialectOptions,
  logging: process.env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : false,
  define: config.define,
  // Serverless functions run many short-lived instances in parallel, each with
  // its own pool, so a small per-instance max avoids exhausting the database's
  // connection limit the way a traditional long-running server's pool of 10 would.
  pool: process.env.VERCEL
    ? { max: 2, min: 0, acquire: 30000, idle: 5000 }
    : { max: 10, min: 0, acquire: 30000, idle: 10000 },
};

const sequelize = config.use_env_variable
  ? new Sequelize(process.env[config.use_env_variable], commonOptions)
  : new Sequelize(config.database, config.username, config.password, {
      host: config.host,
      port: config.port,
      ...commonOptions,
    });

module.exports = sequelize;
