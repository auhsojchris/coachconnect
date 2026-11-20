const { Op } = require('sequelize');
const { sequelize, Coach, Availability, TimeSlot, Booking } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

async function getCoachForActor(req, coachId) {
  const coach = await Coach.findByPk(coachId);
  if (!coach) throw ApiError.notFound('Coach not found');

  const isOwner = req.user.role.name === 'coach' && coach.userId === req.user.id;
  const isAdmin = req.user.role.name === 'admin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('You cannot manage this coach’s availability');

  return coach;
}

// GET /api/coaches/:id/availability — public: view a coach's open time slots
const getCoachAvailability = catchAsync(async (req, res) => {
  const coach = await Coach.findByPk(req.params.id);
  if (!coach) throw ApiError.notFound('Coach not found');

  const { from, to } = req.query;
  const where = { coachId: coach.id, status: 'available' };
  if (from || to) {
    where.date = {};
    if (from) where.date[Op.gte] = from;
    if (to) where.date[Op.lte] = to;
  }

  const [recurringRules, timeSlots] = await Promise.all([
    Availability.findAll({ where: { coachId: coach.id, isActive: true } }),
    TimeSlot.findAll({ where, order: [['date', 'ASC'], ['startTime', 'ASC']] }),
  ]);

  sendResponse(res, 200, 'Availability retrieved', { recurringRules, timeSlots });
});

// POST /api/coaches/availability — coach defines a recurring or one-off window
const createAvailability = catchAsync(async (req, res) => {
  const { coachId, isRecurring, dayOfWeek, specificDate, startTime, endTime } = req.body;
  const coach = await getCoachForActor(req, coachId);

  const availability = await Availability.create({
    coachId: coach.id,
    isRecurring,
    dayOfWeek: isRecurring ? dayOfWeek : null,
    specificDate: isRecurring ? null : specificDate,
    startTime,
    endTime,
  });

  sendResponse(res, 201, 'Availability window created', availability);
});

// PUT /api/coaches/availability/:id
const updateAvailability = catchAsync(async (req, res) => {
  const availability = await Availability.findByPk(req.params.id);
  if (!availability) throw ApiError.notFound('Availability window not found');
  await getCoachForActor(req, availability.coachId);

  const { startTime, endTime, isActive, dayOfWeek, specificDate } = req.body;
  if (startTime !== undefined) availability.startTime = startTime;
  if (endTime !== undefined) availability.endTime = endTime;
  if (isActive !== undefined) availability.isActive = isActive;
  if (dayOfWeek !== undefined) availability.dayOfWeek = dayOfWeek;
  if (specificDate !== undefined) availability.specificDate = specificDate;
  await availability.save();

  sendResponse(res, 200, 'Availability window updated', availability);
});

// DELETE /api/coaches/availability/:id
const deleteAvailability = catchAsync(async (req, res) => {
  const availability = await Availability.findByPk(req.params.id);
  if (!availability) throw ApiError.notFound('Availability window not found');
  await getCoachForActor(req, availability.coachId);

  await availability.destroy();
  sendResponse(res, 200, 'Availability window deleted');
});

// DELETE /api/coaches/time-slots/:id — coach removes a single open slot.
// Booked slots are refused (cancel the booking first). A slot still
// referenced by an old cancelled booking can't be hard-deleted (FK is
// RESTRICT), so it's marked 'blocked' instead — which hides it everywhere
// just the same, since only 'available' slots are ever listed.
const deleteTimeSlot = catchAsync(async (req, res) => {
  const result = await sequelize.transaction(async (t) => {
    const slot = await TimeSlot.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!slot) throw ApiError.notFound('Time slot not found');
    await getCoachForActor(req, slot.coachId);

    if (slot.status === 'booked') {
      throw ApiError.conflict('This slot has a booking — cancel the booking before removing the slot');
    }

    const hasBookingHistory = await Booking.count({ where: { timeSlotId: slot.id }, transaction: t });
    if (hasBookingHistory) {
      slot.status = 'blocked';
      await slot.save({ transaction: t });
      return 'blocked';
    }
    await slot.destroy({ transaction: t });
    return 'deleted';
  });

  sendResponse(res, 200, 'Time slot removed', { id: req.params.id, result });
});

// POST /api/coaches/availability/:id/generate-slots
// Materializes bookable TimeSlot rows for a date range from a recurring rule.
// Kept as an explicit action (rather than an implicit cron) so coaches control
// how far ahead their calendar opens up.
const generateSlots = catchAsync(async (req, res) => {
  const availability = await Availability.findByPk(req.params.id);
  if (!availability) throw ApiError.notFound('Availability window not found');
  const coach = await getCoachForActor(req, availability.coachId);

  const { from, to, slotDurationMinutes = 60 } = req.body;
  if (!from || !to) throw ApiError.badRequest('from and to dates are required');

  // `from`/`to` are date-only strings, which Date parses as UTC midnight —
  // so every calendar computation below must stay in UTC too (getUTCDay,
  // setUTCDate). Mixing in local-time getters/setters shifts the matched
  // weekday by a day on any server whose local timezone is behind UTC.
  const start = new Date(from);
  const end = new Date(to);
  if (start > end) throw ApiError.badRequest('from must be before to');

  const slotsToCreate = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);

    const matchesRecurring = availability.isRecurring && d.getUTCDay() === availability.dayOfWeek;
    const matchesSpecific = !availability.isRecurring && availability.specificDate === dateStr;
    if (!matchesRecurring && !matchesSpecific) continue;

    const [startH, startM] = availability.startTime.split(':').map(Number);
    const [endH, endM] = availability.endTime.split(':').map(Number);
    let cursor = startH * 60 + startM;
    const windowEnd = endH * 60 + endM;

    while (cursor + Number(slotDurationMinutes) <= windowEnd) {
      const slotStart = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
      const nextCursor = cursor + Number(slotDurationMinutes);
      const slotEnd = `${String(Math.floor(nextCursor / 60)).padStart(2, '0')}:${String(nextCursor % 60).padStart(2, '0')}`;

      slotsToCreate.push({ coachId: coach.id, date: dateStr, startTime: slotStart, endTime: slotEnd });
      cursor = nextCursor;
    }
  }

  // ignoreDuplicates relies on the unique (coach_id, date, start_time) index
  // so re-running generation for an overlapping range is safe and idempotent.
  const created = await TimeSlot.bulkCreate(slotsToCreate, { ignoreDuplicates: true });
  sendResponse(res, 201, 'Time slots generated', { count: created.length });
});

module.exports = {
  getCoachAvailability,
  createAvailability,
  updateAvailability,
  deleteAvailability,
  deleteTimeSlot,
  generateSlots,
};
