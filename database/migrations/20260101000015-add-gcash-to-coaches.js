module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('coaches', 'gcash_number', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('coaches', 'gcash_account_name', { type: Sequelize.STRING, allowNull: true });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('coaches', 'gcash_account_name');
    await queryInterface.removeColumn('coaches', 'gcash_number');
  },
};
