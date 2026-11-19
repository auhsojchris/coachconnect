const { v4: uuidv4 } = require('uuid');

const SPORTS = ['Football', 'Basketball', 'Tennis', 'Swimming', 'Athletics', 'Boxing', 'Yoga', 'Cricket'];

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();
    await queryInterface.bulkInsert(
      'sport_categories',
      SPORTS.map((name) => ({
        id: uuidv4(),
        name,
        description: `${name} coaching sessions`,
        is_active: true,
        created_at: now,
        updated_at: now,
      }))
    );
  },
  down: async (queryInterface) => {
    await queryInterface.bulkDelete('sport_categories', null, {});
  },
};
