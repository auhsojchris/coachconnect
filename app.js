require('dotenv').config();
require('express-async-errors');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const hpp = require('hpp');
const xss = require('xss-clean');
const morgan = require('morgan');
const path = require('path');

const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');
const { apiLimiter } = require('./middleware/rateLimiter.middleware');
const paymentController = require('./controllers/payment.controller');
const logger = require('./utils/logger');

const app = express();

app.set('trust proxy', 1);

// ---- Security middleware ----
app.use(helmet());

const allowedOrigins = (process.env.CLIENT_URL || '').split(',').filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  })
);

// Stripe and PayMongo webhooks need the raw request body for signature
// verification, so both must be registered BEFORE the global JSON body
// parser below.
app.post(
  `${process.env.API_PREFIX || '/api'}/payments/webhook`,
  express.raw({ type: 'application/json' }),
  paymentController.handleStripeWebhook
);
app.post(
  `${process.env.API_PREFIX || '/api'}/payments/paymongo/webhook`,
  express.raw({ type: 'application/json' }),
  paymentController.handlePaymongoWebhook
);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(hpp());
app.use(xss());
app.use(compression());

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// Static file serving for uploaded coach profile images.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---- Rate limiting ----
app.use(process.env.API_PREFIX || '/api', apiLimiter);

// ---- Routes ----
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use(process.env.API_PREFIX || '/api', routes);

// ---- Error handling ----
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
