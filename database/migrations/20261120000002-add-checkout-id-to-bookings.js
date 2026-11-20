// Multi-session checkout: bookings created together share a checkout_id so
// they can be paid in one transaction (each keeps its own Payment row, so
// per-session commission/payout accounting is unchanged).
//
// Also drops the UNIQUE constraint on bookings.time_slot_id. A cancelled
// booking keeps pointing at its slot, so with that constraint a slot freed by
// a cancellation showed as available but could never be booked again (unique
// violation) — which would also fail an entire multi-slot request. Double
// booking is still prevented by the slot row lock + status check in
// booking.service, and by the unique (coach_id, date, start_time) on slots.
async function dropTimeSlotUnique(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  if (dialect === 'postgres') {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT c.conname FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'bookings'::regclass AND c.contype = 'u'
        AND a.attname = 'time_slot_id' AND array_length(c.conkey, 1) = 1`);
    for (const { conname } of rows) {
      await queryInterface.sequelize.query(`ALTER TABLE "bookings" DROP CONSTRAINT "${conname}"`);
    }
    return;
  }
  const indexes = await queryInterface.showIndex('bookings');
  for (const idx of indexes) {
    const fields = (idx.fields || []).map((f) => f.attribute);
    if (idx.unique && !idx.primary && fields.length === 1 && fields[0] === 'time_slot_id') {
      await queryInterface.removeIndex('bookings', idx.name);
    }
  }
}

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('bookings', 'checkout_id', { type: Sequelize.UUID, allowNull: true });
    await queryInterface.addIndex('bookings', ['checkout_id'], { name: 'bookings_checkout_id' });
    // Plain index first: MySQL needs *some* index backing the FK before the
    // unique one can go.
    await queryInterface.addIndex('bookings', ['time_slot_id'], { name: 'bookings_time_slot_id' });
    await dropTimeSlotUnique(queryInterface);
  },
  down: async (queryInterface) => {
    // Fails if a slot now has several bookings (e.g. cancelled + rebooked) —
    // clean those up first if you really need to roll back.
    await queryInterface.addConstraint('bookings', { fields: ['time_slot_id'], type: 'unique', name: 'bookings_time_slot_id_key' });
    await queryInterface.removeIndex('bookings', 'bookings_time_slot_id');
    await queryInterface.removeIndex('bookings', 'bookings_checkout_id');
    await queryInterface.removeColumn('bookings', 'checkout_id');
  },
};
