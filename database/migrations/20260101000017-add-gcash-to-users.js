// Lets an admin set their own GCash number so coaches know where to send
// their platform commission when settling it outside the app.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'gcash_number', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('users', 'gcash_account_name', { type: Sequelize.STRING, allowNull: true });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'gcash_account_name');
    await queryInterface.removeColumn('users', 'gcash_number');
  },
};
