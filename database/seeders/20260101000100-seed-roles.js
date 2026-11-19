const { v4: uuidv4 } = require('uuid');

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.bulkInsert('roles', [
      { id: uuidv4(), name: 'admin', description: 'Platform administrator', created_at: new Date(), updated_at: new Date() },
      { id: uuidv4(), name: 'coach', description: 'Sports coach offering sessions', created_at: new Date(), updated_at: new Date() },
      { id: uuidv4(), name: 'client', description: 'Athlete/client booking sessions', created_at: new Date(), updated_at: new Date() },
    ]);
  },
  down: async (queryInterface) => {
    await queryInterface.bulkDelete('roles', null, {});
  },
};
