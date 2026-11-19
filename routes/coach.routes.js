const express = require('express');
const coachController = require('../controllers/coach.controller');
const availabilityController = require('../controllers/availability.controller');
const reviewController = require('../controllers/review.controller');
const authenticate = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');
const upload = require('../middleware/upload.middleware');
const { updateCoachRules, listCoachesRules, coachIdParamRule } = require('../validators/coach.validator');
const { createAvailabilityRules, availabilityIdParamRule } = require('../validators/availability.validator');

const router = express.Router();

// ---- Public ----
router.get('/', listCoachesRules, validate, coachController.listCoaches);
router.get('/:id', coachIdParamRule, validate, coachController.getCoachById);
router.get('/:id/availability', coachIdParamRule, validate, availabilityController.getCoachAvailability);
router.get('/:id/reviews', coachIdParamRule, validate, reviewController.getCoachReviews);

// ---- Availability management (coach/admin) ----
router.post(
  '/availability',
  authenticate,
  authorize('coach', 'admin'),
  createAvailabilityRules,
  validate,
  availabilityController.createAvailability
);
router.put(
  '/availability/:id',
  authenticate,
  authorize('coach', 'admin'),
  availabilityIdParamRule,
  validate,
  availabilityController.updateAvailability
);
router.delete(
  '/availability/:id',
  authenticate,
  authorize('coach', 'admin'),
  availabilityIdParamRule,
  validate,
  availabilityController.deleteAvailability
);
router.post(
  '/availability/:id/generate-slots',
  authenticate,
  authorize('coach', 'admin'),
  availabilityIdParamRule,
  validate,
  availabilityController.generateSlots
);

// ---- Coach profile management ----
router.post('/', authenticate, authorize('admin'), coachController.createCoach);
router.put(
  '/:id',
  authenticate,
  authorize('coach', 'admin'),
  coachIdParamRule,
  updateCoachRules,
  validate,
  coachController.updateCoach
);
router.delete('/:id', authenticate, authorize('admin'), coachIdParamRule, validate, coachController.deleteCoach);
router.post(
  '/:id/image',
  authenticate,
  authorize('coach', 'admin'),
  coachIdParamRule,
  validate,
  upload.single('image'),
  coachController.uploadProfileImage
);

module.exports = router;
