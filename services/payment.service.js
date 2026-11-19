const Stripe = require('stripe');
const ApiError = require('../utils/ApiError');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// The .env.example ships a placeholder key so the app boots without Stripe
// set up; calling the real API with it throws an opaque "Invalid API Key"
// 500. Catch that case up front and surface a clean, actionable error
// instead of leaking the Stripe SDK's error through to the client.
function isStripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return key.startsWith('sk_') && !key.includes('replace');
}

function assertStripeConfigured() {
  if (!isStripeConfigured()) {
    throw ApiError.serviceUnavailable('Payments are not configured yet. Set a real STRIPE_SECRET_KEY in the backend .env to enable checkout.');
  }
}

/**
 * Finds this user's Stripe Customer, creating one on first use. The id is
 * cached on the user row so every later payment/setup intent reuses the same
 * Customer instead of fragmenting their saved cards across several.
 */
async function getOrCreateStripeCustomer(user) {
  assertStripeConfigured();
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId: user.id } });
  await user.update({ stripeCustomerId: customer.id });
  return customer.id;
}

/**
 * Creates a Stripe PaymentIntent for a booking. Amount is converted to the
 * smallest currency unit (cents) as Stripe requires. Attaching the customer
 * with setup_future_usage lets the checkout PaymentElement both offer the
 * client's previously saved cards and save a newly entered one.
 */
async function createPaymentIntent({ amount, currency, bookingId, user }) {
  assertStripeConfigured();
  const customerId = await getOrCreateStripeCustomer(user);
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(Number(amount) * 100),
    currency: currency || process.env.STRIPE_CURRENCY || 'usd',
    receipt_email: user.email,
    metadata: { bookingId },
    customer: customerId,
    setup_future_usage: 'on_session',
    automatic_payment_methods: { enabled: true },
  });
  return paymentIntent;
}

async function retrievePaymentIntent(paymentIntentId) {
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

async function createRefund(paymentIntentId, amount) {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amount ? Math.round(Number(amount) * 100) : undefined,
  });
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

/** Creates a SetupIntent so the client can save a card without charging it. */
async function createSetupIntent(customerId) {
  assertStripeConfigured();
  return stripe.setupIntents.create({ customer: customerId, automatic_payment_methods: { enabled: true } });
}

/** Lists a customer's saved cards, flagging which one is their default. */
async function listPaymentMethods(customerId) {
  assertStripeConfigured();
  const [methods, customer] = await Promise.all([
    stripe.paymentMethods.list({ customer: customerId, type: 'card' }),
    stripe.customers.retrieve(customerId),
  ]);
  const defaultId = customer.deleted ? null : customer.invoice_settings?.default_payment_method || null;
  return methods.data.map((m) => ({
    id: m.id,
    brand: m.card.brand,
    last4: m.card.last4,
    expMonth: m.card.exp_month,
    expYear: m.card.exp_year,
    isDefault: m.id === defaultId,
  }));
}

async function detachPaymentMethod(paymentMethodId) {
  assertStripeConfigured();
  return stripe.paymentMethods.detach(paymentMethodId);
}

async function setDefaultPaymentMethod(customerId, paymentMethodId) {
  assertStripeConfigured();
  return stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
}

module.exports = {
  stripe,
  isStripeConfigured,
  getOrCreateStripeCustomer,
  createPaymentIntent,
  retrievePaymentIntent,
  createRefund,
  constructWebhookEvent,
  createSetupIntent,
  listPaymentMethods,
  detachPaymentMethod,
  setDefaultPaymentMethod,
};
