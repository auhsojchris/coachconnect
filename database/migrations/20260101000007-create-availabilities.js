module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('availabilities', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      coach_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'coaches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      day_of_week: { type: Sequelize.INTEGER, allowNull: true },
      start_time: { type: Sequelize.TIME, allowNull: false },
      end_time: { type: Sequelize.TIME, allowNull: false },
      is_recurring: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      specific_date: { type: Sequelize.DATEONLY, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('availabilities', ['coach_id']);
    await queryInterface.addIndex('availabilities', ['coach_id', 'day_of_week']);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('availabilities');
  },
};
