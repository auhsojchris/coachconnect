const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const config = require('./config')[process.env.NODE_ENV || 'development'];

const sequelize = new Sequelize(config.database, config.username, config.password, {
  host: config.host,
  port: config.port,
  dialect: config.dialect,
  dialectOptions: config.dialectOptions,
  logging: process.env.NODE_ENV === 'development' ? (msg) => logger.debug(msg) : false,
  define: config.define,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

module.exports = sequelize;
