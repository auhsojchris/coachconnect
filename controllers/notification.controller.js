const { Notification } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

// GET /api/notifications
const listNotifications = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const where = { userId: req.user.id };
  if (unreadOnly === 'true') where.isRead = false;

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Notification.findAndCountAll({
    where,
    limit: Number(limit),
    offset,
    order: [['createdAt', 'DESC']],
  });

  sendResponse(res, 200, 'Notifications retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

// PUT /api/notifications/:id/read
const markAsRead = catchAsync(async (req, res) => {
  const notification = await Notification.findByPk(req.params.id);
  if (!notification) throw ApiError.notFound('Notification not found');
  if (notification.userId !== req.user.id) throw ApiError.forbidden('You do not have access to this notification');

  notification.isRead = true;
  await notification.save();
  sendResponse(res, 200, 'Notification marked as read', notification);
});

module.exports = { listNotifications, markAsRead };
