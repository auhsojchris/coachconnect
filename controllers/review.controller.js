const { sequelize, Review, Booking, Coach, User } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');
const notificationService = require('../services/notification.service');

async function recalculateCoachRating(coachId, transaction) {
  const stats = await Review.findOne({
    where: { coachId, isApproved: true },
    attributes: [
      [sequelize.fn('AVG', sequelize.col('rating')), 'avgRating'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
    ],
    raw: true,
    transaction,
  });

  await Coach.update(
    {
      averageRating: stats.avgRating ? Number(stats.avgRating).toFixed(2) : 0,
      totalReviews: Number(stats.total) || 0,
    },
    { where: { id: coachId }, transaction }
  );
}

// GET /api/coaches/:id/reviews
const getCoachReviews = catchAsync(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const { count, rows } = await Review.findAndCountAll({
    where: { coachId: req.params.id, isApproved: true },
    include: [{ model: User, as: 'client', attributes: ['id', 'name', 'profileImage'] }],
    limit: Number(limit),
    offset,
    order: [['createdAt', 'DESC']],
  });

  sendResponse(res, 200, 'Reviews retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

// POST /api/reviews — client reviews a completed booking
const createReview = catchAsync(async (req, res) => {
  if (req.user.role.name !== 'client') throw ApiError.forbidden('Only clients can leave reviews');

  const { bookingId, rating, comment } = req.body;

  const booking = await Booking.findByPk(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.clientId !== req.user.id) throw ApiError.forbidden('You do not have access to this booking');
  if (booking.status !== 'completed') throw ApiError.badRequest('You can only review completed sessions');

  const existing = await Review.findOne({ where: { bookingId } });
  if (existing) throw ApiError.conflict('You have already reviewed this booking');

  const review = await sequelize.transaction(async (t) => {
    const created = await Review.create(
      { bookingId, clientId: req.user.id, coachId: booking.coachId, rating, comment },
      { transaction: t }
    );
    await recalculateCoachRating(booking.coachId, t);
    return created;
  });

  const coach = await Coach.findByPk(booking.coachId);
  await notificationService.createNotification({
    userId: coach.userId,
    type: 'review_received',
    title: 'New review received',
    message: `You received a ${rating}-star review.`,
    metadata: { reviewId: review.id, bookingId },
  });

  sendResponse(res, 201, 'Review submitted', review);
});

// PUT /api/reviews/:id — client edits own review, or admin moderates
const updateReview = catchAsync(async (req, res) => {
  const review = await Review.findByPk(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');

  const role = req.user.role.name;
  const isOwner = role === 'client' && review.clientId === req.user.id;
  const isAdmin = role === 'admin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('You cannot modify this review');

  const { rating, comment, isApproved, isFlagged, flagReason } = req.body;

  if (isOwner) {
    if (rating !== undefined) review.rating = rating;
    if (comment !== undefined) review.comment = comment;
  }
  if (isAdmin) {
    if (isApproved !== undefined) review.isApproved = isApproved;
    if (isFlagged !== undefined) review.isFlagged = isFlagged;
    if (flagReason !== undefined) review.flagReason = flagReason;
  }

  await sequelize.transaction(async (t) => {
    await review.save({ transaction: t });
    await recalculateCoachRating(review.coachId, t);
  });

  sendResponse(res, 200, 'Review updated', review);
});

// DELETE /api/reviews/:id — owner or admin
const deleteReview = catchAsync(async (req, res) => {
  const review = await Review.findByPk(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');

  const role = req.user.role.name;
  const isOwner = role === 'client' && review.clientId === req.user.id;
  const isAdmin = role === 'admin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('You cannot delete this review');

  const coachId = review.coachId;
  await sequelize.transaction(async (t) => {
    await review.destroy({ transaction: t });
    await recalculateCoachRating(coachId, t);
  });

  sendResponse(res, 200, 'Review deleted');
});

module.exports = { getCoachReviews, createReview, updateReview, deleteReview };
