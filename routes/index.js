const express = require('express');

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const coachRoutes = require('./coach.routes');
const bookingRoutes = require('./booking.routes');
const paymentRoutes = require('./payment.routes');
const reviewRoutes = require('./review.routes');
const sportCategoryRoutes = require('./sportCategory.routes');
const notificationRoutes = require('./notification.routes');
const adminRoutes = require('./admin.routes');
const messageRoutes = require('./message.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/coaches', coachRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/reviews', reviewRoutes);
router.use('/sport-categories', sportCategoryRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);
router.use('/messages', messageRoutes);

module.exports = router;
