const { body, param } = require('express-validator');

const createBookingRules = [
  body('coachId').isUUID().withMessage('A valid coachId is required'),
  body('timeSlotId').isUUID().withMessage('A valid timeSlotId is required'),
  body('sportCategoryId').isUUID().withMessage('A valid sportCategoryId is required'),
  body('notes').optional().isLength({ max: 1000 }),
];

const rescheduleBookingRules = [body('newTimeSlotId').isUUID().withMessage('A valid newTimeSlotId is required')];

const cancelBookingRules = [body('reason').optional().isLength({ max: 255 })];

const bookingIdParamRule = [param('id').isUUID().withMessage('Invalid booking id')];

module.exports = { createBookingRules, rescheduleBookingRules, cancelBookingRules, bookingIdParamRule };
