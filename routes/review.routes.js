const express = require('express');
const reviewController = require('../controllers/review.controller');
const authenticate = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { createReviewRules, updateReviewRules, reviewIdParamRule } = require('../validators/review.validator');

const router = express.Router();

router.use(authenticate);

router.post('/', createReviewRules, validate, reviewController.createReview);
router.put('/:id', reviewIdParamRule, updateReviewRules, validate, reviewController.updateReview);
router.delete('/:id', reviewIdParamRule, validate, reviewController.deleteReview);

module.exports = router;
