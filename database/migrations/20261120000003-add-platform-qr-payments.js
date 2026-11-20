// Platform QR checkout: the admin uploads their InstaPay/GCash QR, clients
// pay the platform by scanning it and submit the reference number, and an
// admin verifies it.
//
// Also fixes the notifications.type ENUM, which never included
// 'gcash_submitted' or 'payout_pending' even though the code sends them —
// on Postgres that made those inserts fail outright.
const NEW_TYPES = ['gcash_submitted', 'payout_pending', 'payment_submitted'];
const ALL_TYPES = [
  'booking_confirmed',
  'booking_cancelled',
  'booking_rescheduled',
  'payment_received',
  'payment_failed',
  'session_reminder',
  'review_received',
  'general',
  ...NEW_TYPES,
];

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'gcash_qr_url', { type: Sequelize.STRING(500), allowNull: true });

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      for (const value of NEW_TYPES) {
        await queryInterface.sequelize.query(`ALTER TYPE "enum_notifications_type" ADD VALUE IF NOT EXISTS '${value}'`);
      }
    } else {
      await queryInterface.changeColumn('notifications', 'type', { type: Sequelize.ENUM(...ALL_TYPES), allowNull: false });
    }
  },
  down: async (queryInterface) => {
    // Postgres can't drop enum values; leaving them is harmless.
    await queryInterface.removeColumn('users', 'gcash_qr_url');
  },
};
