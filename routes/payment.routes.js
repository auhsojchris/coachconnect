const express = require('express');
const { body, param } = require('express-validator');
const paymentController = require('../controllers/payment.controller');
const authenticate = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');

const router = express.Router();

// Note: the Stripe webhook (POST /api/payments/webhook) is mounted directly
// in app.js with a raw-body parser, ahead of the global JSON body parser —
// Stripe signature verification requires the exact raw request bytes.

router.use(authenticate);

router.post(
  '/',
  authorize('client', 'admin'),
  [body('bookingId').isUUID().withMessage('A valid bookingId is required')],
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
router.get('/gcash-info/:bookingId', [param('bookingId').isUUID().withMessage('Invalid booking id')], validate, paymentController.getGcashInfo);
router.get('/platform-gcash-account', paymentController.getPlatformGcashAccount);
router.post(
  '/gcash/checkout',
  authorize('client', 'admin'),
  [body('bookingId').isUUID().withMessage('A valid bookingId is required')],
  validate,
  paymentController.startGcashCheckout
);
router.post(
  '/gcash',
  authorize('client', 'admin'),
  [body('bookingId').isUUID().withMessage('A valid bookingId is required'), body('referenceNumber').trim().notEmpty().withMessage('A GCash reference number is required')],
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
