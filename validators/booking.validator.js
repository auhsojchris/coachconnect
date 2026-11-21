const { body, param } = require('express-validator');

const createBookingRules = [
  body('coachId').isUUID().withMessage('A valid coachId is required'),
  body('timeSlotId').isUUID().withMessage('A valid timeSlotId is required'),
  body('sportCategoryId').isUUID().withMessage('A valid sportCategoryId is required'),
  body('courtId').optional({ nullable: true }).isUUID().withMessage('A valid courtId is required'),
  body('notes').optional().isLength({ max: 1000 }),
];

const MAX_SLOTS_PER_CHECKOUT = 10;

const createBookingsBatchRules = [
  body('coachId').isUUID().withMessage('A valid coachId is required'),
  body('timeSlotIds')
    .isArray({ min: 1, max: MAX_SLOTS_PER_CHECKOUT })
    .withMessage(`Choose between 1 and ${MAX_SLOTS_PER_CHECKOUT} time slots`),
  body('timeSlotIds.*').isUUID().withMessage('Each timeSlotId must be a valid id'),
  body('sportCategoryId').isUUID().withMessage('A valid sportCategoryId is required'),
  body('courtId').optional({ nullable: true }).isUUID().withMessage('A valid courtId is required'),
  body('notes').optional().isLength({ max: 1000 }),
];

const rescheduleBookingRules = [body('newTimeSlotId').isUUID().withMessage('A valid newTimeSlotId is required')];

const cancelBookingRules = [body('reason').optional().isLength({ max: 255 })];

const bookingIdParamRule = [param('id').isUUID().withMessage('Invalid booking id')];

module.exports = { createBookingRules, createBookingsBatchRules, rescheduleBookingRules, cancelBookingRules, bookingIdParamRule };
