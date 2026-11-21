const crypto = require('crypto');
const { sequelize, TimeSlot, Booking, Coach, Court } = require('../models');
const ApiError = require('../utils/ApiError');

function timeToMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

function calculateSessionPrice(hourlyRate, startTime, endTime) {
  const durationMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
  const durationHours = durationMinutes / 60;
  return Math.round(Number(hourlyRate) * durationHours * 100) / 100;
}

/**
 * Creates a booking while guaranteeing no double-booking can occur even
 * under concurrent requests for the same slot.
 *
 * Safety mechanism: the target TimeSlot row is locked with SELECT ... FOR
 * UPDATE inside a transaction (via Sequelize's `lock: transaction.LOCK.UPDATE`).
 * A second concurrent request for the same slot blocks on the row lock until
 * the first transaction commits, then re-reads the now-'booked' status and is
 * rejected. This is layered on top of the unique DB index on
 * (coach_id, date, start_time) as a second line of defense.
 */
async function createBooking({ clientId, coachId, timeSlotId, sportCategoryId, courtId, notes }) {
  const [booking] = await createBookings({ clientId, coachId, timeSlotIds: [timeSlotId], sportCategoryId, courtId, notes });
  return booking;
}

/**
 * Books several of one coach's slots at once, all-or-nothing: if any slot is
 * gone, in the past, or not this coach's, nothing is booked. Same locking
 * guarantee as above, applied to every slot. Slots are locked in id order so
 * two overlapping multi-slot requests can't deadlock each other.
 *
 * When more than one slot is booked, the bookings share a checkoutId so the
 * client pays for them together in a single checkout.
 */
async function createBookings({ clientId, coachId, timeSlotIds, sportCategoryId, courtId = null, notes }) {
  const ids = [...new Set(timeSlotIds)].sort();
  if (!ids.length) throw ApiError.badRequest('Choose at least one time slot');

  return sequelize.transaction(async (t) => {
    const coach = await Coach.findByPk(coachId, { transaction: t });
    if (!coach) throw ApiError.notFound('Coach not found');

    // Once an admin has set up courts, every booking says where it happens.
    if (courtId) {
      const court = await Court.findByPk(courtId, { transaction: t });
      if (!court || !court.isActive) throw ApiError.badRequest('That court is not available. Please choose another.');
    } else if (await Court.count({ where: { isActive: true }, transaction: t })) {
      throw ApiError.badRequest('Choose a court for your session');
    }

    const slots = await TimeSlot.findAll({
      where: { id: ids, coachId },
      order: [['id', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (slots.length !== ids.length) {
      throw ApiError.notFound(ids.length > 1 ? 'One or more time slots were not found for this coach' : 'Time slot not found for this coach');
    }

    const now = new Date();
    for (const slot of slots) {
      const when = `${slot.date} ${String(slot.startTime).slice(0, 5)}`;
      if (slot.status !== 'available') {
        throw ApiError.conflict(ids.length > 1 ? `The ${when} slot is no longer available` : 'This time slot is no longer available');
      }
      if (new Date(`${slot.date}T${slot.startTime}`) < now) {
        throw ApiError.badRequest(ids.length > 1 ? `The ${when} slot is in the past` : 'Cannot book a time slot in the past');
      }
    }

    const checkoutId = slots.length > 1 ? crypto.randomUUID() : null;
    const bookings = [];
    for (const slot of slots) {
      slot.status = 'booked';
      await slot.save({ transaction: t });
      bookings.push(
        await Booking.create(
          {
            clientId,
            coachId,
            timeSlotId: slot.id,
            sportCategoryId,
            courtId,
            price: calculateSessionPrice(coach.hourlyRate, slot.startTime, slot.endTime),
            notes,
            status: 'pending',
            checkoutId,
          },
          { transaction: t }
        )
      );
    }
    return bookings;
  });
}

/**
 * Cancels a booking and releases its time slot back to 'available',
 * all inside a single transaction with row locking.
 */
async function cancelBooking(bookingId, cancelledByUserId, reason) {
  return sequelize.transaction(async (t) => {
    const booking = await Booking.findByPk(bookingId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!booking) throw ApiError.notFound('Booking not found');
    if (['cancelled', 'completed'].includes(booking.status)) {
      throw ApiError.conflict(`Booking is already ${booking.status} and cannot be cancelled`);
    }

    const timeSlot = await TimeSlot.findByPk(booking.timeSlotId, { transaction: t, lock: t.LOCK.UPDATE });
    if (timeSlot && timeSlot.status === 'booked') {
      timeSlot.status = 'available';
      await timeSlot.save({ transaction: t });
    }

    booking.status = 'cancelled';
    booking.cancelledBy = cancelledByUserId;
    booking.cancellationReason = reason || null;
    await booking.save({ transaction: t });

    return booking;
  });
}

/**
 * Moves a booking to a new time slot atomically: releases the old slot,
 * locks and claims the new slot, closes out the old booking record, and
 * creates a fresh booking linked back via rescheduledFromId.
 */
async function rescheduleBooking(bookingId, newTimeSlotId) {
  return sequelize.transaction(async (t) => {
    const oldBooking = await Booking.findByPk(bookingId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!oldBooking) throw ApiError.notFound('Booking not found');
    if (['cancelled', 'completed'].includes(oldBooking.status)) {
      throw ApiError.conflict(`Booking is already ${oldBooking.status} and cannot be rescheduled`);
    }

    const oldSlot = await TimeSlot.findByPk(oldBooking.timeSlotId, { transaction: t, lock: t.LOCK.UPDATE });
    const newSlot = await TimeSlot.findOne({
      where: { id: newTimeSlotId, coachId: oldBooking.coachId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!newSlot) throw ApiError.notFound('New time slot not found for this coach');
    if (newSlot.status !== 'available') throw ApiError.conflict('The requested new time slot is not available');

    if (oldSlot) {
      oldSlot.status = 'available';
      await oldSlot.save({ transaction: t });
    }

    newSlot.status = 'booked';
    await newSlot.save({ transaction: t });

    oldBooking.status = 'cancelled';
    oldBooking.cancellationReason = 'Rescheduled to a new time slot';
    await oldBooking.save({ transaction: t });

    const newBooking = await Booking.create(
      {
        clientId: oldBooking.clientId,
        coachId: oldBooking.coachId,
        timeSlotId: newSlot.id,
        sportCategoryId: oldBooking.sportCategoryId,
        courtId: oldBooking.courtId,
        price: oldBooking.price,
        notes: oldBooking.notes,
        status: 'pending',
        rescheduledFromId: oldBooking.id,
      },
      { transaction: t }
    );

    return newBooking;
  });
}

module.exports = { calculateSessionPrice, createBooking, createBookings, cancelBooking, rescheduleBooking };
