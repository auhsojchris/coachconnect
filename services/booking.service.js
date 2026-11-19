const { sequelize, TimeSlot, Booking, Coach } = require('../models');
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
async function createBooking({ clientId, coachId, timeSlotId, sportCategoryId, notes }) {
  return sequelize.transaction(async (t) => {
    const timeSlot = await TimeSlot.findOne({
      where: { id: timeSlotId, coachId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!timeSlot) {
      throw ApiError.notFound('Time slot not found for this coach');
    }
    if (timeSlot.status !== 'available') {
      throw ApiError.conflict('This time slot is no longer available');
    }

    const slotDateTime = new Date(`${timeSlot.date}T${timeSlot.startTime}`);
    if (slotDateTime < new Date()) {
      throw ApiError.badRequest('Cannot book a time slot in the past');
    }

    const coach = await Coach.findByPk(coachId, { transaction: t });
    if (!coach) throw ApiError.notFound('Coach not found');

    const price = calculateSessionPrice(coach.hourlyRate, timeSlot.startTime, timeSlot.endTime);

    timeSlot.status = 'booked';
    await timeSlot.save({ transaction: t });

    const booking = await Booking.create(
      {
        clientId,
        coachId,
        timeSlotId,
        sportCategoryId,
        price,
        notes,
        status: 'pending',
      },
      { transaction: t }
    );

    return booking;
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

module.exports = { calculateSessionPrice, createBooking, cancelBooking, rescheduleBooking };
