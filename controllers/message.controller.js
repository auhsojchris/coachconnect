const { Op } = require('sequelize');
const { Message, Booking, Coach, User } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

const messageInclude = [
  { model: User, as: 'sender', attributes: ['id', 'name', 'profileImage'] },
  { model: User, as: 'recipient', attributes: ['id', 'name', 'profileImage'] },
];

async function getAccessibleBookings(req) {
  const where = req.user.role.name === 'client' ? { clientId: req.user.id } : {};
  if (req.user.role.name === 'coach') {
    const coach = await Coach.findOne({ where: { userId: req.user.id } });
    if (!coach) throw ApiError.notFound('Coach profile not found');
    where.coachId = coach.id;
  }
  return Booking.findAll({ where, attributes: ['id'] });
}

// GET /api/messages — unified feed for the authenticated member
const listMessages = catchAsync(async (req, res) => {
  const bookings = await getAccessibleBookings(req);
  const bookingIds = bookings.map((booking) => booking.id);
  const messages = await Message.findAll({
    where: {
      bookingId: { [Op.in]: bookingIds },
      [Op.or]: [{ senderId: req.user.id }, { recipientId: req.user.id }],
    },
    include: messageInclude,
    order: [['createdAt', 'DESC']],
  });

  await Message.update({ isRead: true }, { where: { bookingId: { [Op.in]: bookingIds }, recipientId: req.user.id, isRead: false } });
  sendResponse(res, 200, 'Messages retrieved', messages);
});

// GET /api/messages/unread-count
const unreadCount = catchAsync(async (req, res) => {
  const bookings = await getAccessibleBookings(req);
  const count = await Message.count({ where: { bookingId: { [Op.in]: bookings.map((booking) => booking.id) }, recipientId: req.user.id, isRead: false } });
  sendResponse(res, 200, 'Unread message count retrieved', { count });
});

// POST /api/messages — clients start a conversation and either party may reply
const sendMessage = catchAsync(async (req, res) => {
  const { bookingId, content } = req.body;
  const booking = await Booking.findByPk(bookingId, { include: { model: Coach, as: 'coach' } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (req.user.role.name === 'client' && booking.clientId !== req.user.id) throw ApiError.forbidden('You do not have access to this booking');
  if (req.user.role.name === 'coach' && booking.coach.userId !== req.user.id) throw ApiError.forbidden('You do not have access to this booking');
  const recipientId = req.user.role.name === 'client' ? booking.coach.userId : booking.clientId;

  const message = await Message.create({ senderId: req.user.id, recipientId, bookingId: booking.id, content });
  const created = await Message.findByPk(message.id, { include: messageInclude });
  sendResponse(res, 201, 'Message sent', created);
});

module.exports = { listMessages, unreadCount, sendMessage };