const crypto = require('crypto');
const ApiError = require('../utils/ApiError');

const BASE_URL = 'https://api.paymongo.com/v1';

// Same "placeholder key ships by default" problem as Stripe — check before
// calling out, so a misconfigured deploy gets a clean 503 instead of an
// opaque auth failure from PayMongo.
function isPaymongoConfigured() {
  const key = process.env.PAYMONGO_SECRET_KEY || '';
  return key.startsWith('sk_') && !key.includes('replace');
}

function assertPaymongoConfigured() {
  if (!isPaymongoConfigured()) {
    throw ApiError.serviceUnavailable('Automatic GCash payments are not configured yet. Set a real PAYMONGO_SECRET_KEY in the backend .env.');
  }
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64');
}

async function pmFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.errors?.[0]?.detail || `PayMongo request failed (${res.status})`;
    throw ApiError.badRequest(message);
  }
  return body;
}

/**
 * Starts a GCash checkout: creates a PaymentIntent, a `gcash` PaymentMethod,
 * attaches them, and returns the redirect URL PayMongo hands back so the
 * client can authorize the payment from their own GCash app/site.
 */
async function createGcashCheckout({ amount, description, bookingId, returnUrl }) {
  assertPaymongoConfigured();

  const intentRes = await pmFetch('/payment_intents', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        attributes: {
          amount: Math.round(Number(amount) * 100),
          currency: 'PHP',
          payment_method_allowed: ['gcash'],
          capture_type: 'automatic',
          description,
          metadata: { bookingId },
        },
      },
    }),
  });
  const paymentIntentId = intentRes.data.id;
  const clientKey = intentRes.data.attributes.client_key;

  const methodRes = await pmFetch('/payment_methods', {
    method: 'POST',
    body: JSON.stringify({ data: { attributes: { type: 'gcash' } } }),
  });

  const attachRes = await pmFetch(`/payment_intents/${paymentIntentId}/attach`, {
    method: 'POST',
    body: JSON.stringify({
      data: { attributes: { payment_method: methodRes.data.id, client_key: clientKey, return_url: returnUrl } },
    }),
  });

  const redirectUrl = attachRes.data.attributes.next_action?.redirect?.url;
  if (!redirectUrl) throw ApiError.internal('PayMongo did not return a redirect URL for this GCash checkout');

  return { paymentIntentId, redirectUrl };
}

async function retrievePaymentIntent(paymentIntentId) {
  assertPaymongoConfigured();
  return pmFetch(`/payment_intents/${paymentIntentId}`);
}

/**
 * Verifies a PayMongo webhook using its `Paymongo-Signature` header, shaped
 * like `t=<timestamp>,te=<testmode sig>,li=<livemode sig>`. Mirrors the
 * intent of Stripe's constructEvent: throws on a bad signature, otherwise
 * returns the parsed event.
 */
function constructWebhookEvent(rawBody, signatureHeader) {
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  if (!secret || secret.includes('replace')) throw new Error('PAYMONGO_WEBHOOK_SECRET is not configured');
  if (!signatureHeader) throw new Error('Missing Paymongo-Signature header');

  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
  const providedSig = parts.li || parts.te;
  if (!parts.t || !providedSig) throw new Error('Malformed Paymongo-Signature header');

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex');
  if (expected !== providedSig) throw new Error('Webhook signature verification failed');

  return JSON.parse(payload);
}

module.exports = { isPaymongoConfigured, createGcashCheckout, retrievePaymentIntent, constructWebhookEvent };
