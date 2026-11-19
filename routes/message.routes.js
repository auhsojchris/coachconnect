const express = require('express');
const { body } = require('express-validator');
const messageController = require('../controllers/message.controller');
const authenticate = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const validate = require('../middleware/validate.middleware');

const router = express.Router();
const messageRules = [
  body('bookingId').isUUID().withMessage('A valid booking id is required'),
  body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Message must be 1-2000 characters'),
];

router.use(authenticate, authorize('client', 'coach'));
router.get('/unread-count', messageController.unreadCount);
router.get('/', messageController.listMessages);
router.post('/', messageRules, validate, messageController.sendMessage);

module.exports = router;