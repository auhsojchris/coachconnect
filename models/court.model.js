// A venue where sessions take place. Admins manage the list; clients pick
// one when booking.
module.exports = (sequelize, DataTypes) => {
  const Court = sequelize.define(
    'Court',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      address: { type: DataTypes.STRING(255), allowNull: true },
      // Inactive courts stay on past bookings but can't be picked for new ones.
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { tableName: 'courts' }
  );

  return Court;
};
