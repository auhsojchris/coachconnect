// Richer coach profiles: a one-line tagline, the skill levels a coach takes
// on (beginner → advanced), and a list of achievements. Plain JSON (not
// JSONB) so the same migration runs on local MySQL and production Postgres.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('coaches', 'tagline', { type: Sequelize.STRING(120), allowNull: true });
    await queryInterface.addColumn('coaches', 'skill_levels', { type: Sequelize.JSON, allowNull: true });
    await queryInterface.addColumn('coaches', 'achievements', { type: Sequelize.JSON, allowNull: true });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('coaches', 'achievements');
    await queryInterface.removeColumn('coaches', 'skill_levels');
    await queryInterface.removeColumn('coaches', 'tagline');
  },
};
