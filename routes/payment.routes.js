const express = require('express');
const { body, param, query } = require('express-validator');
const paymentController = require('../controllers/payment.controller');
const authenticate = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');

const router = express.Router();

// Pay for one booking (plus its checkout siblings) or an explicit list of
// the same coach's bookings.
const MAX_BOOKINGS_PER_PAYMENT = 20;
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
const csvOfUuids = (v) => {
  const ids = String(v).split(',');
  if (ids.length > MAX_BOOKINGS_PER_PAYMENT || !ids.every(isUuid)) throw new Error('bookingIds must be a comma-separated list of booking ids');
  return true;
};
const checkoutTargetRules = [
  body('bookingIds')
    .optional()
    .isArray({ min: 1, max: MAX_BOOKINGS_PER_PAYMENT })
    .withMessage(`Pay for between 1 and ${MAX_BOOKINGS_PER_PAYMENT} sessions at a time`),
  body('bookingIds.*').isUUID().withMessage('Each booking id must be valid'),
  body('bookingId')
    .if(body('bookingIds').not().exists())
    .isUUID()
    .withMessage('A valid bookingId or bookingIds is required'),
];

// Note: the Stripe webhook (POST /api/payments/webhook) is mounted directly
// in app.js with a raw-body parser, ahead of the global JSON body parser —
// Stripe signature verification requires the exact raw request bytes.

router.use(authenticate);

router.post(
  '/',
  authorize('client', 'admin'),
  ...checkoutTargetRules,
  validate,
  paymentController.createPayment
);
router.get('/', paymentController.listPayments);

// Saved payment methods (Stripe cards on file). Registered ahead of the
// generic '/:id' route below so '/methods...' isn't swallowed by it.
router.post('/methods/setup-intent', paymentController.createSetupIntent);
router.get('/methods', paymentController.listPaymentMethods);
router.delete('/methods/:id', [param('id').notEmpty().withMessage('Invalid payment method id')], validate, paymentController.deletePaymentMethod);
router.put('/methods/:id/default', [param('id').notEmpty().withMessage('Invalid payment method id')], validate, paymentController.setDefaultPaymentMethod);

// GCash payments — automatic (PayMongo) when configured, manual fallback
// otherwise. Also registered ahead of '/:id' for the same reason.
router.get('/gcash-info/:bookingId', [param('bookingId').isUUID().withMessage('Invalid booking id'), query('bookingIds').optional().custom(csvOfUuids)], validate, paymentController.getGcashInfo);
router.get('/platform-gcash-account', paymentController.getPlatformGcashAccount);
router.post(
  '/gcash/checkout',
  authorize('client', 'admin'),
  ...checkoutTargetRules,
  validate,
  paymentController.startGcashCheckout
);
router.post(
  '/gcash',
  authorize('client', 'admin'),
  [...checkoutTargetRules, body('referenceNumber').trim().notEmpty().withMessage('A GCash reference number is required')],
  validate,
  paymentController.submitGcashPayment
);

router.get('/:id', [param('id').isUUID().withMessage('Invalid payment id')], validate, paymentController.getPaymentById);
router.put(
  '/:id/confirm-gcash',
  authorize('coach', 'admin'),
  [param('id').isUUID().withMessage('Invalid payment id')],
  validate,
  paymentController.confirmGcashPayment
);
router.put(
  '/:id/reject-gcash',
  authorize('coach', 'admin'),
  [param('id').isUUID().withMessage('Invalid payment id')],
  validate,
  paymentController.rejectGcashPayment
);

module.exports = router;
