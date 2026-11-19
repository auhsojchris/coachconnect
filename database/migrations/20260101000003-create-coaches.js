module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('coaches', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      bio: { type: Sequelize.TEXT, allowNull: true },
      experience_years: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
      hourly_rate: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      location: { type: Sequelize.STRING, allowNull: true },
      city: { type: Sequelize.STRING, allowNull: true },
      country: { type: Sequelize.STRING, allowNull: true },
      average_rating: { type: Sequelize.DECIMAL(3, 2), allowNull: false, defaultValue: 0 },
      total_reviews: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      is_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('coaches', ['city']);
    await queryInterface.addIndex('coaches', ['hourly_rate']);
    await queryInterface.addIndex('coaches', ['average_rating']);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('coaches');
  },
};
