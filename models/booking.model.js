module.exports = (sequelize, DataTypes) => {
  const Booking = sequelize.define(
    'Booking',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      clientId: { type: DataTypes.UUID, allowNull: false },
      coachId: { type: DataTypes.UUID, allowNull: false },
      timeSlotId: { type: DataTypes.UUID, allowNull: false, unique: true },
      sportCategoryId: { type: DataTypes.UUID, allowNull: false },
      status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      cancelledBy: { type: DataTypes.UUID, allowNull: true },
      cancellationReason: { type: DataTypes.STRING, allowNull: true },
      rescheduledFromId: { type: DataTypes.UUID, allowNull: true },
    },
    {
      tableName: 'bookings',
      indexes: [{ fields: ['client_id'] }, { fields: ['coach_id'] }, { fields: ['status'] }],
    }
  );

  return Booking;
};
