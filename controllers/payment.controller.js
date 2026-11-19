const { Op } = require('sequelize');
const { sequelize, Payment, Booking, Coach, Role, User } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');
const paymentService = require('../services/payment.service');
const paymongoService = require('../services/paymongo.service');
const notificationService = require('../services/notification.service');
const { sendBookingReceiptEmail } = require('../services/email.service');
const logger = require('../utils/logger');

const paymentInclude = [{ model: Booking, as: 'booking' }];

async function assertOwnsPayment(req, payment) {
  if (req.user.role.name === 'admin') return;
  if (req.user.role.name === 'client' && payment.booking.clientId === req.user.id) return;
  if (req.user.role.name === 'coach') {
    const coach = await Coach.findOne({ where: { userId: req.user.id } });
    if (coach && payment.booking.coachId === coach.id) return;
  }
  throw ApiError.forbidden('You do not have access to this payment');
}

// POST /api/payments — create a Stripe PaymentIntent for a booking
const createPayment = catchAsync(async (req, res) => {
  const { bookingId } = req.body;

  const booking = await Booking.findByPk(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.clientId !== req.user.id && req.user.role.name !== 'admin') {
    throw ApiError.forbidden('You do not have access to this booking');
  }
  if (booking.status !== 'pending') {
    throw ApiError.conflict('Only pending bookings can be paid for');
  }

  const existingPayment = await Payment.findOne({ where: { bookingId } });
  if (existingPayment && existingPayment.status === 'paid') {
    throw ApiError.conflict('This booking has already been paid for');
  }

  const paymentIntent = await paymentService.createPaymentIntent({
    amount: booking.price,
    currency: process.env.STRIPE_CURRENCY,
    bookingId: booking.id,
    user: req.user,
  });

  const payment = existingPayment
    ? await existingPayment.update({
        amount: booking.price,
        status: 'pending',
        stripePaymentIntentId: paymentIntent.id,
      })
    : await Payment.create({
        bookingId,
        amount: booking.price,
        currency: process.env.STRIPE_CURRENCY || 'usd',
        status: 'pending',
        stripePaymentIntentId: paymentIntent.id,
      });

  sendResponse(res, 201, 'Payment initiated', {
    payment,
    clientSecret: paymentIntent.client_secret,
  });
});

// GET /api/payments — role-scoped list
const listPayments = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const role = req.user.role.name;

  const bookingWhere = {};
  if (role === 'client') bookingWhere.clientId = req.user.id;
  if (role === 'coach') {
    const coach = await Coach.findOne({ where: { userId: req.user.id } });
    if (!coach) throw ApiError.notFound('Coach profile not found');
    bookingWhere.coachId = coach.id;
  }

  const where = {};
  if (status) where.status = status;

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Payment.findAndCountAll({
    where,
    include: [{ model: Booking, as: 'booking', where: bookingWhere, required: true }],
    limit: Number(limit),
    offset,
    distinct: true,
    order: [['createdAt', 'DESC']],
  });

  sendResponse(res, 200, 'Payments retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

// GET /api/payments/:id
const getPaymentById = catchAsync(async (req, res) => {
  const payment = await Payment.findByPk(req.params.id, { include: paymentInclude });
  if (!payment) throw ApiError.notFound('Payment not found');
  await assertOwnsPayment(req, payment);
  sendResponse(res, 200, 'Payment retrieved', payment);
});

// Percentage of the booking price the platform charges as commission on
// GCash bookings, since that money goes straight to the coach and never
// passes through the platform's own Stripe balance. Configurable via env;
// defaults to 10%.
const PLATFORM_FEE_RATE = Number(process.env.PLATFORM_FEE_RATE) || 0.1;

// GET /api/payments/gcash-info/:bookingId — GCash checkout details for this
// booking. When PayMongo is configured, the client pays the platform
// automatically and the coach's own number is irrelevant here (it only
// matters later, for the platform to pay the coach out) — so it's not
// required. Only the manual fallback needs the coach to have set one up.
// Scoped to the booking's own client/admin so a coach's personal GCash
// number never leaks publicly.
const getGcashInfo = catchAsync(async (req, res) => {
  const booking = await Booking.findByPk(req.params.bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.clientId !== req.user.id && req.user.role.name !== 'admin') {
    throw ApiError.forbidden('You do not have access to this booking');
  }

  const paymongoConfigured = paymongoService.isPaymongoConfigured();
  if (paymongoConfigured) {
    return sendResponse(res, 200, 'GCash info retrieved', {
      number: '',
      accountName: '',
      platformFeeRate: PLATFORM_FEE_RATE,
      paymongoConfigured: true,
    });
  }

  const coach = await Coach.findByPk(booking.coachId, { attributes: ['id', 'gcashNumber', 'gcashAccountName'] });
  if (!coach || !coach.gcashNumber) {
    throw ApiError.badRequest('This coach has not set up GCash payments yet');
  }

  sendResponse(res, 200, 'GCash info retrieved', {
    number: coach.gcashNumber,
    accountName: coach.gcashAccountName || '',
    platformFeeRate: PLATFORM_FEE_RATE,
    paymongoConfigured: false,
  });
});

// POST /api/payments/gcash/checkout — starts an automatic GCash payment via
// PayMongo: the client is redirected to authorize it themselves, money lands
// in the platform's PayMongo balance (not the coach's), and a webhook
// confirms it — no reference number, no waiting on the coach to confirm.
const startGcashCheckout = catchAsync(async (req, res) => {
  const { bookingId } = req.body;

  const booking = await Booking.findByPk(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.clientId !== req.user.id && req.user.role.name !== 'admin') {
    throw ApiError.forbidden('You do not have access to this booking');
  }
  if (booking.status !== 'pending') {
    throw ApiError.conflict('Only pending bookings can be paid for');
  }

  const existingPayment = await Payment.findOne({ where: { bookingId } });
  if (existingPayment && existingPayment.status === 'paid') {
    throw ApiError.conflict('This booking has already been paid for');
  }

  const platformFeeAmount = Math.round(Number(booking.price) * PLATFORM_FEE_RATE * 100) / 100;
  const payoutAmount = Math.round((Number(booking.price) - platformFeeAmount) * 100) / 100;
  const returnUrl = `${process.env.CLIENT_URL}/payment-return?bookingId=${booking.id}`;

  const { paymentIntentId, redirectUrl } = await paymongoService.createGcashCheckout({
    amount: booking.price,
    description: `Booking ${booking.id}`,
    bookingId: booking.id,
    returnUrl,
  });

  if (existingPayment) {
    await existingPayment.update({
      provider: 'paymongo',
      status: 'pending',
      paymongoPaymentIntentId: paymentIntentId,
      amount: booking.price,
      currency: 'php',
      platformFeeAmount,
      platformFeeRate: PLATFORM_FEE_RATE,
      payoutAmount,
      payoutSettled: false,
    });
  } else {
    await Payment.create({
      bookingId,
      amount: booking.price,
      currency: 'php',
      status: 'pending',
      provider: 'paymongo',
      paymongoPaymentIntentId: paymentIntentId,
      platformFeeAmount,
      platformFeeRate: PLATFORM_FEE_RATE,
      payoutAmount,
    });
  }

  sendResponse(res, 201, 'GCash checkout started', { redirectUrl });
});

// GET /api/payments/platform-gcash-account — where a coach should send their
// owed platform commission when settling it outside the app.
const getPlatformGcashAccount = catchAsync(async (req, res) => {
  const admin = await User.findOne({
    where: { gcashNumber: { [Op.ne]: null } },
    include: [{ model: Role, as: 'role', where: { name: 'admin' } }],
    attributes: ['gcashNumber', 'gcashAccountName'],
  });
  if (!admin) throw ApiError.badRequest('The platform has not set up a GCash account for commission settlement yet');
  sendResponse(res, 200, 'Platform GCash account retrieved', { number: admin.gcashNumber, accountName: admin.gcashAccountName || '' });
});

// POST /api/payments/gcash — client reports a GCash payment sent directly to
// the coach's own number. The platform's cut is recorded as a commission the
// coach owes (visible to admin), not deducted from what the client sends.
const submitGcashPayment = catchAsync(async (req, res) => {
  const { bookingId, referenceNumber } = req.body;

  const booking = await Booking.findByPk(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.clientId !== req.user.id && req.user.role.name !== 'admin') {
    throw ApiError.forbidden('You do not have access to this booking');
  }
  if (booking.status !== 'pending') {
    throw ApiError.conflict('Only pending bookings can be paid for');
  }

  const existingPayment = await Payment.findOne({ where: { bookingId } });
  if (existingPayment && existingPayment.status === 'paid') {
    throw ApiError.conflict('This booking has already been paid for');
  }

  const platformFeeAmount = Math.round(Number(booking.price) * PLATFORM_FEE_RATE * 100) / 100;

  const payment = existingPayment
    ? await existingPayment.update({
        provider: 'gcash',
        status: 'submitted',
        gcashReference: referenceNumber,
        amount: booking.price,
        platformFeeAmount,
        platformFeeRate: PLATFORM_FEE_RATE,
        platformFeeSettled: false,
      })
    : await Payment.create({
        bookingId,
        amount: booking.price,
        currency: process.env.STRIPE_CURRENCY || 'usd',
        status: 'submitted',
        provider: 'gcash',
        gcashReference: referenceNumber,
        platformFeeAmount,
        platformFeeRate: PLATFORM_FEE_RATE,
      });

  const coach = await Coach.findByPk(booking.coachId);
  if (coach) await notificationService.notifyGcashSubmitted(payment, coach.userId);

  sendResponse(res, 201, 'GCash payment submitted — waiting for your coach to confirm receipt', payment);
});

// Loads a payment for the GCash confirm/reject actions, checking it's an
// unresolved GCash submission the requester (its coach, or an admin) owns.
async function loadOwnedGcashPayment(req) {
  const payment = await Payment.findByPk(req.params.id, { include: paymentInclude });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.provider !== 'gcash') throw ApiError.badRequest('This payment was not made via GCash');
  if (payment.status !== 'submitted') throw ApiError.conflict('This payment has already been resolved');
  if (req.user.role.name === 'admin') return payment;
  if (req.user.role.name === 'coach') {
    const coach = await Coach.findOne({ where: { userId: req.user.id } });
    if (coach && payment.booking.coachId === coach.id) return payment;
  }
  throw ApiError.forbidden('You do not have access to this payment');
}

// PUT /api/payments/:id/confirm-gcash — coach/admin confirms the money arrived
const confirmGcashPayment = catchAsync(async (req, res) => {
  const payment = await loadOwnedGcashPayment(req);

  await sequelize.transaction(async (t) => {
    payment.status = 'paid';
    payment.paidAt = new Date();
    await payment.save({ transaction: t });
    payment.booking.status = 'confirmed';
    await payment.booking.save({ transaction: t });
  });

  await notificationService.notifyPaymentReceived(payment, payment.booking.clientId);
  const client = await User.findByPk(payment.booking.clientId);
  if (client) await sendBookingReceiptEmail(client, payment.booking, payment);

  sendResponse(res, 200, 'GCash payment confirmed', payment);
});

// PUT /api/payments/:id/reject-gcash — coach/admin couldn't verify the payment
const rejectGcashPayment = catchAsync(async (req, res) => {
  const payment = await loadOwnedGcashPayment(req);
  payment.status = 'failed';
  await payment.save();

  await notificationService.notifyGcashRejected(payment, payment.booking.clientId);

  sendResponse(res, 200, 'GCash payment rejected', payment);
});

// POST /api/payments/methods/setup-intent — start saving a new card
const createSetupIntent = catchAsync(async (req, res) => {
  const customerId = await paymentService.getOrCreateStripeCustomer(req.user);
  const setupIntent = await paymentService.createSetupIntent(customerId);
  sendResponse(res, 201, 'Setup intent created', { clientSecret: setupIntent.client_secret });
});

// GET /api/payments/methods — this client's saved cards
const listPaymentMethods = catchAsync(async (req, res) => {
  if (!req.user.stripeCustomerId) return sendResponse(res, 200, 'Payment methods retrieved', []);
  const methods = await paymentService.listPaymentMethods(req.user.stripeCustomerId);
  sendResponse(res, 200, 'Payment methods retrieved', methods);
});

async function assertOwnsPaymentMethod(req, methodId) {
  if (!req.user.stripeCustomerId) throw ApiError.notFound('Payment method not found');
  const methods = await paymentService.listPaymentMethods(req.user.stripeCustomerId);
  if (!methods.some((m) => m.id === methodId)) throw ApiError.notFound('Payment method not found');
}

// DELETE /api/payments/methods/:id — remove a saved card
const deletePaymentMethod = catchAsync(async (req, res) => {
  await assertOwnsPaymentMethod(req, req.params.id);
  await paymentService.detachPaymentMethod(req.params.id);
  sendResponse(res, 200, 'Payment method removed', null);
});

// PUT /api/payments/methods/:id/default — mark a saved card as the default
const setDefaultPaymentMethod = catchAsync(async (req, res) => {
  await assertOwnsPaymentMethod(req, req.params.id);
  await paymentService.setDefaultPaymentMethod(req.user.stripeCustomerId, req.params.id);
  sendResponse(res, 200, 'Default payment method updated', null);
});

// POST /api/payments/webhook — Stripe webhook (raw body, no auth middleware)
// Source of truth for payment status: never trust the client to report success.
const handleStripeWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = paymentService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    logger.error(`Stripe webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    const payment = await Payment.findOne({
      where: { stripePaymentIntentId: intent.id },
      include: [{ model: Booking, as: 'booking' }],
    });

    if (payment) {
      await sequelize.transaction(async (t) => {
        if (event.type === 'payment_intent.succeeded') {
          payment.status = 'paid';
          payment.paidAt = new Date();
          payment.receiptUrl = intent.charges?.data?.[0]?.receipt_url || payment.receiptUrl;
          await payment.save({ transaction: t });

          payment.booking.status = 'confirmed';
          await payment.booking.save({ transaction: t });
        } else {
          payment.status = 'failed';
          await payment.save({ transaction: t });
        }
      });

      const client = await User.findByPk(payment.booking.clientId);
      if (event.type === 'payment_intent.succeeded') {
        await notificationService.notifyPaymentReceived(payment, payment.booking.clientId);
        if (client) await sendBookingReceiptEmail(client, payment.booking, payment);
      } else {
        await notificationService.notifyPaymentFailed(payment, payment.booking.clientId);
      }
    }
  }

  res.status(200).json({ received: true });
});

// POST /api/payments/paymongo/webhook — PayMongo webhook (raw body, no auth
// middleware). Source of truth for whether the GCash payment actually went
// through — the client's browser redirect back is not trusted on its own.
const handlePaymongoWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['paymongo-signature'];

  let event;
  try {
    event = paymongoService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    logger.error(`PayMongo webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const eventType = event.data?.attributes?.type;
  const paymentAttributes = event.data?.attributes?.data?.attributes;
  const paymentIntentId = paymentAttributes?.payment_intent_id;

  if ((eventType === 'payment.paid' || eventType === 'payment.failed') && paymentIntentId) {
    const payment = await Payment.findOne({
      where: { paymongoPaymentIntentId: paymentIntentId },
      include: [{ model: Booking, as: 'booking' }],
    });

    if (payment && payment.status !== 'paid') {
      await sequelize.transaction(async (t) => {
        if (eventType === 'payment.paid') {
          payment.status = 'paid';
          payment.paidAt = new Date();
          await payment.save({ transaction: t });

          payment.booking.status = 'confirmed';
          await payment.booking.save({ transaction: t });
        } else {
          payment.status = 'failed';
          await payment.save({ transaction: t });
        }
      });

      const client = await User.findByPk(payment.booking.clientId);
      if (eventType === 'payment.paid') {
        await notificationService.notifyPaymentReceived(payment, payment.booking.clientId);
        if (client) await sendBookingReceiptEmail(client, payment.booking, payment);
        const coach = await Coach.findByPk(payment.booking.coachId);
        if (coach) await notificationService.notifyPayoutPending(payment, coach.userId);
      } else {
        await notificationService.notifyPaymentFailed(payment, payment.booking.clientId);
      }
    }
  }

  res.status(200).json({ received: true });
});

module.exports = {
  createPayment,
  listPayments,
  getPaymentById,
  handleStripeWebhook,
  handlePaymongoWebhook,
  createSetupIntent,
  listPaymentMethods,
  deletePaymentMethod,
  setDefaultPaymentMethod,
  getGcashInfo,
  getPlatformGcashAccount,
  startGcashCheckout,
  submitGcashPayment,
  confirmGcashPayment,
  rejectGcashPayment,
};
