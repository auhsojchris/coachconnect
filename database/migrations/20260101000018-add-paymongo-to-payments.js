// PayMongo collects the client's GCash payment into the platform's own
// PayMongo balance (real custody, unlike the manual flow where money never
// touches the platform). That flips who owes whom: instead of the coach
// owing the platform a commission, the platform now owes the coach their
// net share — tracked here as a payout, settled the same way (manually,
// outside the app, since PayMongo's public API has no third-party payout
// product on a standard key).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('payments', 'paymongo_payment_intent_id', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('payments', 'payout_amount', { type: Sequelize.DECIMAL(10, 2), allowNull: true });
    await queryInterface.addColumn('payments', 'payout_settled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await queryInterface.addIndex('payments', ['paymongo_payment_intent_id']);
  },
  down: async (queryInterface) => {
    await queryInterface.removeIndex('payments', ['paymongo_payment_intent_id']);
    await queryInterface.removeColumn('payments', 'payout_settled');
    await queryInterface.removeColumn('payments', 'payout_amount');
    await queryInterface.removeColumn('payments', 'paymongo_payment_intent_id');
  },
};
