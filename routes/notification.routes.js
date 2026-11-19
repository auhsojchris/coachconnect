const express = require('express');
const { param } = require('express-validator');
const notificationController = require('../controllers/notification.controller');
const authenticate = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', notificationController.listNotifications);
router.put(
  '/:id/read',
  [param('id').isUUID().withMessage('Invalid notification id')],
  validate,
  notificationController.markAsRead
);

module.exports = router;
