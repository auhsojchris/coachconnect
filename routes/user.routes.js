const express = require('express');
const userController = require('../controllers/user.controller');
const authenticate = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const authorize = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.post('/profile/image', upload.single('image'), userController.uploadProfileImage);
// Admin: the platform's payment QR that clients scan at checkout.
router.post('/profile/gcash-qr', authorize('admin'), upload.single('image'), userController.uploadGcashQr);
router.delete('/profile/gcash-qr', authorize('admin'), userController.removeGcashQr);

module.exports = router;
