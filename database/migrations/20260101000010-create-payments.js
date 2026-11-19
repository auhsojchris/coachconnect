module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('payments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      booking_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'bookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'usd' },
      status: {
        type: Sequelize.ENUM('pending', 'paid', 'refunded', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      provider: { type: Sequelize.STRING, allowNull: false, defaultValue: 'stripe' },
      stripe_payment_intent_id: { type: Sequelize.STRING, allowNull: true },
      receipt_url: { type: Sequelize.STRING, allowNull: true },
      paid_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('payments', ['status']);
    await queryInterface.addIndex('payments', ['stripe_payment_intent_id']);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('payments');
  },
};
