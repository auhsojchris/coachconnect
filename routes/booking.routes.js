const express = require('express');
const bookingController = require('../controllers/booking.controller');
const authenticate = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createBookingRules,
  createBookingsBatchRules,
  rescheduleBookingRules,
  cancelBookingRules,
  bookingIdParamRule,
} = require('../validators/booking.validator');

const router = express.Router();

router.use(authenticate);

router.get('/', bookingController.listBookings);
router.get('/:id', bookingIdParamRule, validate, bookingController.getBookingById);
router.post('/', createBookingRules, validate, bookingController.createBooking);
router.post('/batch', createBookingsBatchRules, validate, bookingController.createBookingsBatch);
router.put('/:id', bookingIdParamRule, validate, bookingController.updateBooking);
router.post('/:id/cancel', bookingIdParamRule, cancelBookingRules, validate, bookingController.cancelBooking);
router.post(
  '/:id/reschedule',
  bookingIdParamRule,
  rescheduleBookingRules,
  validate,
  bookingController.rescheduleBooking
);

module.exports = router;
