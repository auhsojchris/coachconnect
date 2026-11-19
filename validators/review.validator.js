const { body, param } = require('express-validator');

const createReviewRules = [
  body('bookingId').isUUID().withMessage('A valid bookingId is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('rating must be 1-5'),
  body('comment').optional().isLength({ max: 2000 }),
];

const updateReviewRules = [
  body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('rating must be 1-5'),
  body('comment').optional().isLength({ max: 2000 }),
];

const reviewIdParamRule = [param('id').isUUID().withMessage('Invalid review id')];

module.exports = { createReviewRules, updateReviewRules, reviewIdParamRule };
