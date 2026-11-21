// Courts: venues admins manage and clients pick when booking.
// Purely additive — a new table and a nullable bookings.court_id — so code
// that doesn't know about courts keeps working against the migrated schema.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('courts', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      address: { type: Sequelize.STRING(255), allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addColumn('bookings', 'court_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'courts', key: 'id' },
      onUpdate: 'CASCADE',
      // The API refuses to delete a court that has bookings; this is the backstop.
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('bookings', ['court_id'], { name: 'bookings_court_id' });
  },
  down: async (queryInterface) => {
    // MySQL won't drop the index while the foreign key needs it, so drop the
    // key first; removing the column then takes its index with it.
    const refs = await queryInterface.getForeignKeyReferencesForTable('bookings');
    for (const ref of refs.filter((r) => r.columnName === 'court_id')) {
      await queryInterface.removeConstraint('bookings', ref.constraintName);
    }
    await queryInterface.removeColumn('bookings', 'court_id');
    await queryInterface.dropTable('courts');
  },
};
