const { Notification } = require('../models');

/**
 * Creates an in-app notification record. Kept as a thin wrapper so that
 * push/SMS channels can be added later without touching call sites.
 */
async function createNotification({ userId, type, title, message, metadata }, options = {}) {
  return Notification.create({ userId, type, title, message, metadata }, options);
}

async function notifyBookingConfirmed(booking, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'booking_confirmed',
      title: 'Booking confirmed',
      message: `Your booking for ${booking.id} has been confirmed.`,
      metadata: { bookingId: booking.id },
    },
    options
  );
}

async function notifyBookingCancelled(booking, recipientUserId, reason, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'booking_cancelled',
      title: 'Booking cancelled',
      message: `Your booking for ${booking.id} was cancelled${reason ? `: ${reason}` : '.'}`,
      metadata: { bookingId: booking.id },
    },
    options
  );
}

async function notifyBookingRescheduled(booking, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'booking_rescheduled',
      title: 'Booking rescheduled',
      message: `Your booking for ${booking.id} has been rescheduled.`,
      metadata: { bookingId: booking.id },
    },
    options
  );
}

async function notifyPaymentReceived(payment, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'payment_received',
      title: 'Payment received',
      message: `We received your payment of ${payment.amount} ${payment.currency.toUpperCase()}.`,
      metadata: { paymentId: payment.id, bookingId: payment.bookingId },
    },
    options
  );
}

async function notifyPaymentFailed(payment, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'payment_failed',
      title: 'Payment failed',
      message: `Your payment for booking ${payment.bookingId} failed.`,
      metadata: { paymentId: payment.id, bookingId: payment.bookingId },
    },
    options
  );
}

async function notifyGcashSubmitted(payment, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'gcash_submitted',
      title: 'GCash payment submitted',
      message: `A client submitted a GCash payment (ref: ${payment.gcashReference}) for booking ${payment.bookingId} — please confirm once you've received it.`,
      metadata: { paymentId: payment.id, bookingId: payment.bookingId },
    },
    options
  );
}

async function notifyGcashRejected(payment, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'payment_failed',
      title: 'GCash payment not confirmed',
      message: `Your GCash payment for booking ${payment.bookingId} could not be verified. Please try again or contact your coach.`,
      metadata: { paymentId: payment.id, bookingId: payment.bookingId },
    },
    options
  );
}

async function notifyPayoutPending(payment, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'payout_pending',
      title: 'Payout on the way',
      message: `A client paid ${payment.amount} ${payment.currency.toUpperCase()} via GCash for booking ${payment.bookingId}. Your net share of ${payment.payoutAmount} is queued for the platform to send you.`,
      metadata: { paymentId: payment.id, bookingId: payment.bookingId },
    },
    options
  );
}

async function notifySessionReminder(booking, recipientUserId, options = {}) {
  return createNotification(
    {
      userId: recipientUserId,
      type: 'session_reminder',
      title: 'Upcoming session reminder',
      message: `You have a coaching session coming up (booking ${booking.id}).`,
      metadata: { bookingId: booking.id },
    },
    options
  );
}

module.exports = {
  createNotification,
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingRescheduled,
  notifyPaymentReceived,
  notifyPaymentFailed,
  notifyGcashSubmitted,
  notifyGcashRejected,
  notifyPayoutPending,
  notifySessionReminder,
};
