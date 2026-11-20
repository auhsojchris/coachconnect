const crypto = require('crypto');
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

const roundMoney = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Resolves what a checkout started from `bookingId` actually pays for. A
 * booking created alone pays for itself. A booking from a multi-slot request
 * pays for every still-pending, still-unpaid booking sharing its checkoutId,
 * so one payment covers all of them. Sessions cancelled before payment just
 * drop out of the total.
 */
function assertPayable(req, booking) {
  if (booking.clientId !== req.user.id && req.user.role.name !== 'admin') {
    throw ApiError.forbidden('You do not have access to this booking');
  }
  if (booking.status !== 'pending') {
    throw ApiError.conflict('Only pending bookings can be paid for');
  }
}

/**
 * Two ways to say what's being paid for:
 * - `bookingIds`: an explicit selection (the Bookings page "pay for these
 *   sessions" card). All must be the same client's pending bookings with the
 *   same coach — a manual GCash transfer goes to one coach's number.
 * - `bookingId`: one booking, plus every pending sibling sharing its
 *   checkoutId (sessions booked together on the coach page).
 *
 * Already-paid bookings drop out. With `claim`, used when a payment is
 * actually started (never on a read), an explicit selection is stamped with
 * a fresh shared checkoutId so webhooks and the coach's GCash confirm/reject
 * treat exactly these bookings as one payment, and none stays attached to an
 * older group that could also try to charge for it.
 */
async function loadCheckout(req, { bookingId, bookingIds }, { claim = false } = {}) {
  let booking;
  let candidates;

  if (Array.isArray(bookingIds) && bookingIds.length) {
    const ids = [...new Set(bookingIds)];
    candidates = await Booking.findAll({ where: { id: ids }, order: [['createdAt', 'ASC']] });
    if (candidates.length !== ids.length) throw ApiError.notFound('One or more bookings were not found');
    candidates.forEach((b) => assertPayable(req, b));
    if (new Set(candidates.map((b) => b.coachId)).size > 1 || new Set(candidates.map((b) => b.clientId)).size > 1) {
      throw ApiError.badRequest('Sessions paid together must all be with the same coach');
    }
    booking = candidates[0];
  } else {
    booking = await Booking.findByPk(bookingId);
    if (!booking) throw ApiError.notFound('Booking not found');
    assertPayable(req, booking);
    candidates = booking.checkoutId
      ? await Booking.findAll({
          where: { checkoutId: booking.checkoutId, clientId: booking.clientId, status: 'pending' },
          order: [['createdAt', 'ASC']],
        })
      : [booking];
  }

  const existing = await Payment.findAll({ where: { bookingId: candidates.map((b) => b.id) } });
  const paymentByBooking = new Map(existing.map((p) => [p.bookingId, p]));
  const bookings = candidates.filter((b) => paymentByBooking.get(b.id)?.status !== 'paid');
  if (!bookings.length) throw ApiError.conflict('This booking has already been paid for');

  if (claim && Array.isArray(bookingIds) && bookingIds.length) {
    const checkoutId = bookings.length > 1 ? crypto.randomUUID() : null;
    await Booking.update({ checkoutId }, { where: { id: bookings.map((b) => b.id) } });
    bookings.forEach((b) => { b.checkoutId = checkoutId; });
  }

  return {
    booking: bookings[0],
    bookings,
    paymentByBooking,
    total: roundMoney(bookings.reduce((sum, b) => sum + Number(b.price), 0)),
  };
}

/** What a payment request body/query asks to pay for. */
function checkoutTarget(source) {
  const raw = source.bookingIds;
  const bookingIds = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? raw.split(',') : undefined;
  return { bookingId: source.bookingId, bookingIds };
}

/** Creates or updates the Payment row for each booking in a checkout. */
async function upsertCheckoutPayments({ bookings, paymentByBooking }, fieldsFor) {
  const payments = [];
  for (const b of bookings) {
    const fields = { amount: b.price, ...fieldsFor(b) };
    const existing = paymentByBooking.get(b.id);
    payments.push(existing ? await existing.update(fields) : await Payment.create({ bookingId: b.id, ...fields }));
  }
  return payments;
}

/** Platform commission and coach payout for one booking's price. */
function splitFee(price) {
  const platformFeeAmount = roundMoney(Number(price) * PLATFORM_FEE_RATE);
  return { platformFeeAmount, payoutAmount: roundMoney(Number(price) - platformFeeAmount) };
}

// POST /api/payments — create a Stripe PaymentIntent for a booking (or for
// every booking in its multi-session checkout)
const createPayment = catchAsync(async (req, res) => {
  const checkout = await loadCheckout(req, checkoutTarget(req.body), { claim: true });

  const paymentIntent = await paymentService.createPaymentIntent({
    amount: checkout.total,
    currency: process.env.STRIPE_CURRENCY,
    bookingId: checkout.booking.id,
    user: req.user,
  });

  const payments = await upsertCheckoutPayments(checkout, () => ({
    currency: process.env.STRIPE_CURRENCY || 'usd',
    provider: 'stripe',
    status: 'pending',
    stripePaymentIntentId: paymentIntent.id,
  }));

  sendResponse(res, 201, 'Payment initiated', {
    payment: payments[0],
    payments,
    total: checkout.total,
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
  const checkout = await loadCheckout(req, { ...checkoutTarget(req.query), bookingId: req.params.bookingId });
  const summary = { amount: checkout.total, sessionCount: checkout.bookings.length, platformFeeRate: PLATFORM_FEE_RATE };

  const paymongoConfigured = paymongoService.isPaymongoConfigured();
  if (paymongoConfigured) {
    return sendResponse(res, 200, 'GCash info retrieved', { ...summary, number: '', accountName: '', paymongoConfigured: true });
  }

  const coach = await Coach.findByPk(checkout.booking.coachId, { attributes: ['id', 'gcashNumber', 'gcashAccountName'] });
  if (!coach || !coach.gcashNumber) {
    throw ApiError.badRequest('This coach has not set up GCash payments yet');
  }

  sendResponse(res, 200, 'GCash info retrieved', {
    ...summary,
    number: coach.gcashNumber,
    accountName: coach.gcashAccountName || '',
    paymongoConfigured: false,
  });
});

// POST /api/payments/gcash/checkout — starts an automatic GCash payment via
// PayMongo: the client is redirected to authorize it themselves, money lands
// in the platform's PayMongo balance (not the coach's), and a webhook
// confirms it — no reference number, no waiting on the coach to confirm.
const startGcashCheckout = catchAsync(async (req, res) => {
  const checkout = await loadCheckout(req, checkoutTarget(req.body), { claim: true });
  const { booking, bookings } = checkout;
  const returnUrl = `${process.env.CLIENT_URL}/payment-return?bookingId=${booking.id}`;

  const { paymentIntentId, redirectUrl } = await paymongoService.createGcashCheckout({
    amount: checkout.total,
    description: bookings.length > 1 ? `${bookings.length} coaching sessions (checkout ${booking.checkoutId})` : `Booking ${booking.id}`,
    bookingId: booking.id,
    returnUrl,
  });

  await upsertCheckoutPayments(checkout, (b) => ({
    provider: 'paymongo',
    status: 'pending',
    paymongoPaymentIntentId: paymentIntentId,
    currency: 'php',
    platformFeeRate: PLATFORM_FEE_RATE,
    ...splitFee(b.price),
    payoutSettled: false,
  }));

  sendResponse(res, 201, 'GCash checkout started', { redirectUrl, total: checkout.total, sessionCount: bookings.length });
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

// ---- Platform QR checkout ----------------------------------------------
// The client scans the admin's InstaPay/GCash QR, pays the platform the
// checkout total, and submits the reference number. An admin verifies it.
// The platform then holds the money, so (like PayMongo) each session's
// payoutAmount is what the platform owes the coach.
const PLATFORM_QR = 'platform_qr';

async function findPlatformQrAccount() {
  return User.findOne({
    where: { gcashQrUrl: { [Op.ne]: null } },
    include: [{ model: Role, as: 'role', where: { name: 'admin' } }],
    attributes: ['id', 'gcashQrUrl', 'gcashNumber', 'gcashAccountName'],
    order: [['createdAt', 'ASC']],
  });
}

// GET /api/payments/qr-checkout/:bookingId(?bookingIds=a,b) — what to pay and
// where. `configured: false` (not an error) when no admin has uploaded a QR,
// so the client can fall back to the other payment options.
const getQrCheckout = catchAsync(async (req, res) => {
  const checkout = await loadCheckout(req, { ...checkoutTarget(req.query), bookingId: req.params.bookingId });
  const account = await findPlatformQrAccount();
  sendResponse(res, 200, 'QR checkout retrieved', {
    configured: !!account,
    amount: checkout.total,
    sessionCount: checkout.bookings.length,
    qrUrl: account?.gcashQrUrl || null,
    number: account?.gcashNumber || '',
    accountName: account?.gcashAccountName || '',
  });
});

// POST /api/payments/qr — client reports they paid the platform's QR.
const submitQrPayment = catchAsync(async (req, res) => {
  const referenceNumber = String(req.body.referenceNumber).trim();
  if (!(await findPlatformQrAccount())) throw ApiError.badRequest('QR payments are not set up yet');

  // A reference already used for a different payment is almost certainly a
  // mistake (or a reused receipt) — catch it before an admin has to.
  const reused = await Payment.findOne({
    where: { provider: PLATFORM_QR, gcashReference: referenceNumber, status: { [Op.in]: ['submitted', 'paid'] } },
    include: [{ model: Booking, as: 'booking', attributes: ['id', 'clientId'] }],
  });

  const checkout = await loadCheckout(req, checkoutTarget(req.body), { claim: true });
  const ownIds = new Set(checkout.bookings.map((b) => b.id));
  if (reused && !ownIds.has(reused.bookingId)) {
    throw ApiError.conflict('This reference number was already used for another payment. Please check it and try again.');
  }

  const payments = await upsertCheckoutPayments(checkout, (b) => ({
    provider: PLATFORM_QR,
    status: 'submitted',
    gcashReference: referenceNumber,
    currency: 'php',
    platformFeeRate: PLATFORM_FEE_RATE,
    ...splitFee(b.price),
    platformFeeSettled: false,
    payoutSettled: false,
  }));

  const admins = await User.findAll({ include: [{ model: Role, as: 'role', where: { name: 'admin' } }], attributes: ['id'] });
  for (const admin of admins) {
    await notificationService.createNotification({
      userId: admin.id,
      type: 'payment_submitted',
      title: 'QR payment to verify',
      message: `A client paid ₱${checkout.total.toLocaleString()} for ${payments.length} session(s) (ref: ${referenceNumber}). Check it arrived, then confirm it in Admin → Payments.`,
      metadata: { paymentId: payments[0].id, bookingId: payments[0].bookingId },
    });
  }

  sendResponse(res, 201, 'Payment submitted — the platform will confirm it shortly', {
    payment: payments[0],
    total: checkout.total,
    sessionCount: payments.length,
  });
});

// POST /api/payments/gcash — client reports a GCash payment sent directly to
// the coach's own number. The platform's cut is recorded as a commission the
// coach owes (visible to admin), not deducted from what the client sends.
const submitGcashPayment = catchAsync(async (req, res) => {
  const { referenceNumber } = req.body;
  const checkout = await loadCheckout(req, checkoutTarget(req.body), { claim: true });

  // One GCash transfer covers every session in the checkout, so they all
  // carry the same reference and are confirmed/rejected together.
  const payments = await upsertCheckoutPayments(checkout, (b) => ({
    provider: 'gcash',
    status: 'submitted',
    gcashReference: referenceNumber,
    currency: 'php',
    platformFeeAmount: splitFee(b.price).platformFeeAmount,
    platformFeeRate: PLATFORM_FEE_RATE,
    platformFeeSettled: false,
  }));

  const coach = await Coach.findByPk(checkout.booking.coachId);
  if (coach) await notificationService.notifyGcashSubmitted(payments[0], coach.userId);

  sendResponse(res, 201, 'GCash payment submitted — waiting for your coach to confirm receipt', payments[0]);
});

// Loads a payment for the GCash confirm/reject actions, checking it's an
// unresolved GCash submission the requester (its coach, or an admin) owns.
// Returns it together with any sibling payments from the same multi-session
// checkout that were paid with the same GCash transfer.
async function loadOwnedGcashPayments(req) {
  const payment = await Payment.findByPk(req.params.id, { include: paymentInclude });
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.provider !== 'gcash' && payment.provider !== PLATFORM_QR) throw ApiError.badRequest('This payment was not made via GCash');
  if (payment.status !== 'submitted') throw ApiError.conflict('This payment has already been resolved');

  let allowed = req.user.role.name === 'admin';
  // The platform received QR payments, so only an admin can verify them.
  if (!allowed && req.user.role.name === 'coach' && payment.provider === 'gcash') {
    const coach = await Coach.findOne({ where: { userId: req.user.id } });
    allowed = !!coach && payment.booking.coachId === coach.id;
  }
  if (!allowed) throw ApiError.forbidden('You do not have access to this payment');

  if (!payment.booking.checkoutId) return [payment];
  return Payment.findAll({
    where: { provider: payment.provider, status: 'submitted', gcashReference: payment.gcashReference },
    include: [{ model: Booking, as: 'booking', required: true, where: { checkoutId: payment.booking.checkoutId } }],
  });
}

// PUT /api/payments/:id/confirm-gcash — coach/admin confirms the money arrived
const confirmGcashPayment = catchAsync(async (req, res) => {
  const payments = await loadOwnedGcashPayments(req);

  await sequelize.transaction(async (t) => {
    for (const payment of payments) {
      payment.status = 'paid';
      payment.paidAt = new Date();
      await payment.save({ transaction: t });
      payment.booking.status = 'confirmed';
      await payment.booking.save({ transaction: t });
    }
  });

  // QR payments went to the platform, which now owes the coach their share.
  await notifyPaid(payments, { notifyCoachPayout: payments[0].provider === PLATFORM_QR });
  sendResponse(res, 200, payments.length > 1 ? `GCash payment confirmed for ${payments.length} sessions` : 'GCash payment confirmed', payments[0]);
});

// PUT /api/payments/:id/reject-gcash — coach/admin couldn't verify the payment
const rejectGcashPayment = catchAsync(async (req, res) => {
  const payments = await loadOwnedGcashPayments(req);
  await sequelize.transaction(async (t) => {
    for (const payment of payments) {
      payment.status = 'failed';
      await payment.save({ transaction: t });
    }
  });

  await notificationService.notifyGcashRejected(payments[0], payments[0].booking.clientId);

  sendResponse(res, 200, 'GCash payment rejected', payments[0]);
});

/**
 * In-app notification + receipt email for payments that just succeeded. A
 * multi-session checkout gets one notification (not one per session) but a
 * receipt per booking, since each receipt describes a specific session.
 */
async function notifyPaid(payments, { notifyCoachPayout = false } = {}) {
  if (!payments.length) return;
  const first = payments[0];
  // Notification messages read amount/payoutAmount off the payment, so hand
  // them the checkout's combined totals rather than one session's share.
  const combined = {
    id: first.id,
    bookingId: first.bookingId,
    currency: first.currency,
    amount: roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0)),
    payoutAmount: roundMoney(payments.reduce((s, p) => s + Number(p.payoutAmount || 0), 0)),
  };
  await notificationService.notifyPaymentReceived(combined, first.booking.clientId);
  const client = await User.findByPk(first.booking.clientId);
  if (client) {
    for (const p of payments) await sendBookingReceiptEmail(client, p.booking, p);
  }
  if (notifyCoachPayout) {
    const coach = await Coach.findByPk(first.booking.coachId);
    if (coach) await notificationService.notifyPayoutPending(combined, coach.userId);
  }
}

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
    // One intent can cover several bookings (multi-session checkout).
    const payments = await Payment.findAll({
      where: { stripePaymentIntentId: intent.id, status: { [Op.ne]: 'paid' } },
      include: [{ model: Booking, as: 'booking' }],
    });

    if (payments.length) {
      const succeeded = event.type === 'payment_intent.succeeded';
      await sequelize.transaction(async (t) => {
        for (const payment of payments) {
          if (succeeded) {
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
        }
      });

      if (succeeded) await notifyPaid(payments);
      else await notificationService.notifyPaymentFailed(payments[0], payments[0].booking.clientId);
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
    // One intent can cover several bookings (multi-session checkout).
    const payments = await Payment.findAll({
      where: { paymongoPaymentIntentId: paymentIntentId, status: { [Op.ne]: 'paid' } },
      include: [{ model: Booking, as: 'booking' }],
    });

    if (payments.length) {
      const paid = eventType === 'payment.paid';
      await sequelize.transaction(async (t) => {
        for (const payment of payments) {
          if (paid) {
            payment.status = 'paid';
            payment.paidAt = new Date();
            await payment.save({ transaction: t });
            payment.booking.status = 'confirmed';
            await payment.booking.save({ transaction: t });
          } else {
            payment.status = 'failed';
            await payment.save({ transaction: t });
          }
        }
      });

      if (paid) await notifyPaid(payments, { notifyCoachPayout: true });
      else await notificationService.notifyPaymentFailed(payments[0], payments[0].booking.clientId);
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
  getQrCheckout,
  submitQrPayment,
  confirmGcashPayment,
  rejectGcashPayment,
};
