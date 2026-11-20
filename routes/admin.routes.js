const express = require('express');
const { param, body, query } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const authenticate = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/reviews', adminController.listReviews);

router.get('/users', adminController.listUsers);
router.post(
  '/users',
  [
    body('name').trim().isLength({ min: 2, max: 100 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).matches(/\d/),
    body('phone').optional().isMobilePhone('any'),
    body('role').isIn(['admin', 'coach', 'client']),
  ],
  validate,
  adminController.createUser
);
router.get('/users/:id', [param('id').isUUID()], validate, adminController.getUserById);
router.put(
  '/users/:id',
  [param('id').isUUID(), body('role').optional().isIn(['admin', 'coach', 'client']), body('isActive').optional().isBoolean(), body('emailVerified').optional().isBoolean()],
  validate,
  adminController.updateUser
);
router.delete('/users/:id', [param('id').isUUID()], validate, adminController.deleteUser);

router.put(
  '/coaches/:id/verify',
  [param('id').isUUID(), body('isVerified').optional().isBoolean()],
  validate,
  adminController.verifyCoach
);

router.get('/gcash-commissions', adminController.listGcashCommissions);
router.put(
  '/gcash-commissions/:paymentId/settle',
  [param('paymentId').isUUID(), body('settled').optional().isBoolean()],
  validate,
  adminController.settleGcashCommission
);

router.get(
  '/qr-payments',
  [query('status').optional().isIn(['submitted', 'paid', 'failed', 'all'])],
  validate,
  adminController.listQrPayments
);

router.get('/gcash-payouts', adminController.listGcashPayouts);
router.put(
  '/gcash-payouts/:paymentId/settle',
  [param('paymentId').isUUID(), body('settled').optional().isBoolean()],
  validate,
  adminController.settleGcashPayout
);

module.exports = router;
