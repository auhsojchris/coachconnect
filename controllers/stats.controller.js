const { sequelize, Coach, SportCategory, Booking, Review } = require('../models');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

// GET /api/stats — public platform metrics for the marketing homepage.
const getPublicStats = catchAsync(async (req, res) => {
  const [coachCount, sportCount, completedSessions, ratingResult] = await Promise.all([
    Coach.count({ where: { isVerified: true } }),
    SportCategory.count({ where: { isActive: true } }),
    Booking.count({ where: { status: 'completed' } }),
    Review.findOne({
      where: { isApproved: true },
      attributes: [
        [sequelize.fn('AVG', sequelize.col('rating')), 'averageRating'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'reviewCount'],
      ],
      raw: true,
    }),
  ]);

  sendResponse(res, 200, 'Platform statistics retrieved', {
    coachCount,
    sportCount,
    completedSessions,
    averageRating: ratingResult.averageRating ? Math.round(Number(ratingResult.averageRating) * 10) / 10 : null,
    reviewCount: Number(ratingResult.reviewCount) || 0,
  });
});

module.exports = { getPublicStats };
