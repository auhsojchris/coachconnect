const { body, param, query } = require('express-validator');

const updateCoachRules = [
  body('bio').optional().isLength({ max: 2000 }),
  body('experienceYears').optional().isInt({ min: 0, max: 60 }),
  body('hourlyRate').optional().isFloat({ min: 0 }),
  body('location').optional().isString().trim(),
  body('city').optional().isString().trim(),
  body('country').optional().isString().trim(),
  body('gcashNumber').optional().isString().trim().isLength({ max: 20 }),
  body('gcashAccountName').optional().isString().trim().isLength({ max: 100 }),
  body('specializations').optional().isArray(),
  body('specializations.*.sportCategoryId').optional().isUUID(),
  body('specializations.*.certification').optional().isString(),
  body('specializations.*.yearsExperience').optional().isInt({ min: 0 }),
];

const listCoachesRules = [
  query('sport').optional().isString(),
  query('city').optional().isString(),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('minRating').optional().isFloat({ min: 0, max: 5 }),
  query('date').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const coachIdParamRule = [param('id').isUUID().withMessage('Invalid coach id')];

module.exports = { updateCoachRules, listCoachesRules, coachIdParamRule };
