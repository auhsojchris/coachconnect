// GCash payments go straight from client to coach — the platform never
// touches the money — so instead of deducting a cut, we record it as a
// commission the coach owes, for admin to see and settle outside the app.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('payments', 'platform_fee_amount', { type: Sequelize.DECIMAL(10, 2), allowNull: true });
    await queryInterface.addColumn('payments', 'platform_fee_rate', { type: Sequelize.DECIMAL(5, 4), allowNull: true });
    await queryInterface.addColumn('payments', 'platform_fee_settled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('payments', 'platform_fee_settled');
    await queryInterface.removeColumn('payments', 'platform_fee_rate');
    await queryInterface.removeColumn('payments', 'platform_fee_amount');
  },
};
