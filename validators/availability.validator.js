const { body, param } = require('express-validator');

// isRecurring arrives as a real JSON boolean on normal requests, but
// express-validator's `.equals()` does a strict string comparison — so
// `.equals('true')` never matches an actual boolean `true`. Compare the raw
// request value directly instead.
const isRecurringTrue = (req) => req.body.isRecurring === true || req.body.isRecurring === 'true';

const createAvailabilityRules = [
  body('coachId').isUUID().withMessage('coachId must be a valid id'),
  body('isRecurring').isBoolean().withMessage('isRecurring must be boolean'),
  body('dayOfWeek')
    .if((_value, { req }) => isRecurringTrue(req))
    .isInt({ min: 0, max: 6 })
    .withMessage('dayOfWeek must be 0-6'),
  body('specificDate')
    .if((_value, { req }) => !isRecurringTrue(req))
    .isISO8601()
    .withMessage('specificDate must be a valid date'),
  body('startTime').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('startTime must be HH:mm'),
  body('endTime').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('endTime must be HH:mm'),
];

const availabilityIdParamRule = [param('id').isUUID().withMessage('Invalid availability id')];
const timeSlotIdParamRule = [param('id').isUUID().withMessage('Invalid time slot id')];

module.exports = { createAvailabilityRules, availabilityIdParamRule, timeSlotIdParamRule };
