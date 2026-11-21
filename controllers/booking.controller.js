const { Op } = require('sequelize');
const { Booking, Coach, User, TimeSlot, SportCategory, Payment, Court } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');
const bookingService = require('../services/booking.service');
const notificationService = require('../services/notification.service');

const bookingInclude = [
  { model: User, as: 'client', attributes: ['id', 'name', 'email', 'phone'] },
  { model: Coach, as: 'coach', include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }] },
  { model: TimeSlot, as: 'timeSlot' },
  { model: SportCategory, as: 'sportCategory' },
  { model: Court, as: 'court', attributes: ['id', 'name', 'address'] },
  { model: Payment, as: 'payment' },
];

async function loadBookingOr404(id) {
  const booking = await Booking.findByPk(id, { include: bookingInclude });
  if (!booking) throw ApiError.notFound('Booking not found');
  return booking;
}

function assertCanViewOrManage(req, booking) {
  const role = req.user.role.name;
  if (role === 'admin') return;
  if (role === 'client' && booking.clientId === req.user.id) return;
  if (role === 'coach' && booking.coach.userId === req.user.id) return;
  throw ApiError.forbidden('You do not have access to this booking');
}

// GET /api/bookings — role-scoped list with status/time filters
const listBookings = catchAsync(async (req, res) => {
  const { status, timeframe, page = 1, limit = 20 } = req.query;
  const role = req.user.role.name;

  const where = {};
  if (status) where.status = status;

  if (role === 'client') {
    where.clientId = req.user.id;
  } else if (role === 'coach') {
    const coach = await Coach.findOne({ where: { userId: req.user.id } });
    if (!coach) throw ApiError.notFound('Coach profile not found');
    where.coachId = coach.id;
  }
  // admin: no scoping — sees all bookings

  const include = [...bookingInclude];
  if (timeframe === 'upcoming' || timeframe === 'past') {
    const today = new Date().toISOString().slice(0, 10);
    include[2] = {
      ...include[2],
      required: true,
      where: timeframe === 'upcoming' ? { date: { [Op.gte]: today } } : { date: { [Op.lt]: today } },
    };
  }

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Booking.findAndCountAll({
    where,
    include,
    limit: Number(limit),
    offset,
    distinct: true,
    order: [['createdAt', 'DESC']],
  });

  sendResponse(res, 200, 'Bookings retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

// GET /api/bookings/:id
const getBookingById = catchAsync(async (req, res) => {
  const booking = await loadBookingOr404(req.params.id);
  assertCanViewOrManage(req, booking);
  sendResponse(res, 200, 'Booking retrieved', booking);
});

// POST /api/bookings — clients book a session
const createBooking = catchAsync(async (req, res) => {
  if (req.user.role.name !== 'client') throw ApiError.forbidden('Only clients can create bookings');

  const { coachId, timeSlotId, sportCategoryId, courtId, notes } = req.body;
  const booking = await bookingService.createBooking({
    clientId: req.user.id,
    coachId,
    timeSlotId,
    sportCategoryId,
    courtId,
    notes,
  });

  const full = await loadBookingOr404(booking.id);
  sendResponse(res, 201, 'Booking created, awaiting payment confirmation', full);
});

// POST /api/bookings/batch — book several of one coach's slots in one go.
// All-or-nothing; the bookings share a checkoutId and are paid together.
const createBookingsBatch = catchAsync(async (req, res) => {
  if (req.user.role.name !== 'client') throw ApiError.forbidden('Only clients can create bookings');

  const { coachId, timeSlotIds, sportCategoryId, courtId, notes } = req.body;
  const created = await bookingService.createBookings({
    clientId: req.user.id,
    coachId,
    timeSlotIds,
    sportCategoryId,
    courtId,
    notes,
  });

  const bookings = await Booking.findAll({
    where: { id: created.map((b) => b.id) },
    include: bookingInclude,
    order: [[{ model: TimeSlot, as: 'timeSlot' }, 'date', 'ASC'], [{ model: TimeSlot, as: 'timeSlot' }, 'startTime', 'ASC']],
  });
  const total = bookings.reduce((sum, b) => sum + Number(b.price), 0);

  sendResponse(res, 201, `${bookings.length} session(s) booked, awaiting payment`, {
    checkoutId: created[0].checkoutId,
    total: Math.round(total * 100) / 100,
    bookings,
  });
});

// PUT /api/bookings/:id — coach/admin updates status (confirm, complete)
const updateBooking = catchAsync(async (req, res) => {
  const booking = await loadBookingOr404(req.params.id);
  const role = req.user.role.name;

  if (role === 'client') throw ApiError.forbidden('Clients cannot directly change booking status');
  if (role === 'coach' && booking.coach.userId !== req.user.id) {
    throw ApiError.forbidden('You do not have access to this booking');
  }

  const { status } = req.body;
  const allowedTransitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
  };
  if (!allowedTransitions[booking.status] || !allowedTransitions[booking.status].includes(status)) {
    throw ApiError.badRequest(`Cannot transition booking from ${booking.status} to ${status}`);
  }

  // Cancelling here must go through the same service used by POST
  // /:id/cancel so the underlying TimeSlot is released back to 'available'
  // — setting booking.status directly would leave the slot stuck as 'booked'.
  if (status === 'cancelled') {
    await bookingService.cancelBooking(booking.id, req.user.id, req.body.reason);
    await notificationService.notifyBookingCancelled(booking, booking.clientId, req.body.reason);
  } else {
    booking.status = status;
    await booking.save();

    if (status === 'confirmed') {
      await notificationService.notifyBookingConfirmed(booking, booking.clientId);
    }
  }

  const updated = await loadBookingOr404(booking.id);
  sendResponse(res, 200, 'Booking updated', updated);
});

// POST /api/bookings/:id/cancel
const cancelBooking = catchAsync(async (req, res) => {
  const existing = await loadBookingOr404(req.params.id);
  assertCanViewOrManage(req, existing);

  const booking = await bookingService.cancelBooking(req.params.id, req.user.id, req.body.reason);

  const recipientId = req.user.role.name === 'client' ? existing.coach.userId : existing.clientId;
  await notificationService.notifyBookingCancelled(booking, recipientId, req.body.reason);

  const updated = await loadBookingOr404(booking.id);
  sendResponse(res, 200, 'Booking cancelled', updated);
});

// POST /api/bookings/:id/reschedule
const rescheduleBooking = catchAsync(async (req, res) => {
  const existing = await loadBookingOr404(req.params.id);
  assertCanViewOrManage(req, existing);

  const newBooking = await bookingService.rescheduleBooking(req.params.id, req.body.newTimeSlotId);

  const recipientId = req.user.role.name === 'client' ? existing.coach.userId : existing.clientId;
  await notificationService.notifyBookingRescheduled(newBooking, recipientId);

  const full = await loadBookingOr404(newBooking.id);
  sendResponse(res, 200, 'Booking rescheduled', full);
});

module.exports = {
  listBookings,
  getBookingById,
  createBooking,
  createBookingsBatch,
  updateBooking,
  cancelBooking,
  rescheduleBooking,
};
