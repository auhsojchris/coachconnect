module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('payments', 'gcash_reference', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    // MySQL/MariaDB has no native "add enum value" — widen the column directly.
    await queryInterface.sequelize.query(
      "ALTER TABLE payments MODIFY COLUMN status ENUM('pending','submitted','paid','refunded','failed') NOT NULL DEFAULT 'pending'"
    );
  },
  down: async (queryInterface) => {
    await queryInterface.sequelize.query("UPDATE payments SET status = 'pending' WHERE status = 'submitted'");
    await queryInterface.sequelize.query(
      "ALTER TABLE payments MODIFY COLUMN status ENUM('pending','paid','refunded','failed') NOT NULL DEFAULT 'pending'"
    );
    await queryInterface.removeColumn('payments', 'gcash_reference');
  },
};
