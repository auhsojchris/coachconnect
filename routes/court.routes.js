const express = require('express');
const { body, param } = require('express-validator');
const courtController = require('../controllers/court.controller');
const authenticate = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');

const router = express.Router();
const admin = [authenticate, authorize('admin')];
const idRule = param('id').isUUID().withMessage('Invalid court id');
const addressRule = body('address').optional({ nullable: true }).isString().trim().isLength({ max: 255 }).withMessage('Address is too long');

router.get('/', courtController.listCourts);
router.get('/all', admin, courtController.listAllCourts);
router.post(
  '/',
  admin,
  [body('name').isString().trim().notEmpty().withMessage('Court name is required').isLength({ max: 120 }).withMessage('Court name is too long'), addressRule],
  validate,
  courtController.createCourt
);
router.put(
  '/:id',
  admin,
  [
    idRule,
    body('name').optional().isString().trim().notEmpty().withMessage('Court name cannot be empty').isLength({ max: 120 }),
    addressRule,
    body('isActive').optional().isBoolean(),
  ],
  validate,
  courtController.updateCourt
);
router.delete('/:id', admin, [idRule], validate, courtController.deleteCourt);

module.exports = router;
