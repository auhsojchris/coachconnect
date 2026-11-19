module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('coach_specializations', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      coach_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'coaches', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sport_category_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'sport_categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      certification: { type: Sequelize.STRING, allowNull: true },
      years_experience: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('coach_specializations', ['coach_id', 'sport_category_id'], { unique: true });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('coach_specializations');
  },
};
