const { body, param, query } = require('express-validator');

const SKILL_LEVELS = ['beginner', 'novice', 'intermediate', 'advanced'];

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
  body('specializations.*.certification').optional({ values: 'null' }).isString().trim().isLength({ max: 150 }),
  body('specializations.*.yearsExperience').optional({ values: 'null' }).isInt({ min: 0, max: 60 }),
  body('tagline').optional({ values: 'null' }).isString().trim().isLength({ max: 120 }),
  body('skillLevels').optional().isArray({ max: SKILL_LEVELS.length }),
  body('skillLevels.*').isIn(SKILL_LEVELS).withMessage(`Skill levels must be one of: ${SKILL_LEVELS.join(', ')}`),
  body('achievements').optional().isArray({ max: 20 }).withMessage('Up to 20 achievements'),
  body('achievements.*.title', 'Each achievement needs a title (max 120 chars)').isString().bail().trim().notEmpty().isLength({ max: 120 }),
  body('achievements.*.year').optional({ values: 'falsy' }).isInt({ min: 1950, max: 2100 }).withMessage('Achievement year must be a valid year'),
  body('achievements.*.description').optional({ values: 'falsy' }).isString().trim().isLength({ max: 300 }),
];

const listCoachesRules = [
  query('sport').optional().isString(),
  query('city').optional().isString(),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('minRating').optional().isFloat({ min: 0, max: 5 }),
  query('level').optional().isIn(SKILL_LEVELS).withMessage(`level must be one of: ${SKILL_LEVELS.join(', ')}`),
  query('date').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

const coachIdParamRule = [param('id').isUUID().withMessage('Invalid coach id')];

module.exports = { SKILL_LEVELS, updateCoachRules, listCoachesRules, coachIdParamRule };
