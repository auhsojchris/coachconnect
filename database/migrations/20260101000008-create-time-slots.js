module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('time_slots', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      coach_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'coaches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      start_time: { type: Sequelize.TIME, allowNull: false },
      end_time: { type: Sequelize.TIME, allowNull: false },
      status: {
        type: Sequelize.ENUM('available', 'booked', 'blocked'),
        allowNull: false,
        defaultValue: 'available',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    // Database-level guarantee: a coach can only have one slot per start time per day.
    await queryInterface.addIndex('time_slots', ['coach_id', 'date', 'start_time'], { unique: true });
    await queryInterface.addIndex('time_slots', ['coach_id', 'date', 'status']);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('time_slots');
  },
};
