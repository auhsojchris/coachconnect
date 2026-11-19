module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('bookings', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      client_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      coach_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'coaches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      time_slot_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'time_slots', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      sport_category_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'sport_categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      status: {
        type: Sequelize.ENUM('pending', 'confirmed', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      notes: { type: Sequelize.TEXT, allowNull: true },
      cancelled_by: { type: Sequelize.UUID, allowNull: true },
      cancellation_reason: { type: Sequelize.STRING, allowNull: true },
      rescheduled_from_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'bookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('bookings', ['client_id']);
    await queryInterface.addIndex('bookings', ['coach_id']);
    await queryInterface.addIndex('bookings', ['status']);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('bookings');
  },
};
