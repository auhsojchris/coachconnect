module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('payments', 'gcash_reference', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    // MySQL/MariaDB has no native "add enum value" — widen the column directly.
    // Postgres enum types work the opposite way: you add a value to the existing
    // type rather than redefining the column.
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query("ALTER TYPE \"enum_payments_status\" ADD VALUE IF NOT EXISTS 'submitted'");
    } else {
      await queryInterface.sequelize.query(
        "ALTER TABLE payments MODIFY COLUMN status ENUM('pending','submitted','paid','refunded','failed') NOT NULL DEFAULT 'pending'"
      );
    }
  },
  down: async (queryInterface) => {
    await queryInterface.sequelize.query("UPDATE payments SET status = 'pending' WHERE status = 'submitted'");
    // Postgres can't drop an enum value in place; leaving the unused value on
    // the type is harmless, so the down migration only reverts the data and column.
    if (queryInterface.sequelize.getDialect() !== 'postgres') {
      await queryInterface.sequelize.query(
        "ALTER TABLE payments MODIFY COLUMN status ENUM('pending','paid','refunded','failed') NOT NULL DEFAULT 'pending'"
      );
    }
    await queryInterface.removeColumn('payments', 'gcash_reference');
  },
};
