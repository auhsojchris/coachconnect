const express = require('express');
const { body, param } = require('express-validator');
const sportCategoryController = require('../controllers/sportCategory.controller');
const authenticate = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');

const router = express.Router();

router.get('/', sportCategoryController.listSportCategories);

router.post(
  '/',
  authenticate,
  authorize('admin'),
  [body('name').trim().notEmpty().withMessage('name is required')],
  validate,
  sportCategoryController.createSportCategory
);
router.put(
  '/:id',
  authenticate,
  authorize('admin'),
  [param('id').isUUID().withMessage('Invalid sport category id')],
  validate,
  sportCategoryController.updateSportCategory
);
router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  [param('id').isUUID().withMessage('Invalid sport category id')],
  validate,
  sportCategoryController.deleteSportCategory
);

module.exports = router;
