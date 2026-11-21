module.exports = (sequelize, DataTypes) => {
  const Booking = sequelize.define(
    'Booking',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      clientId: { type: DataTypes.UUID, allowNull: false },
      coachId: { type: DataTypes.UUID, allowNull: false },
      // Not unique: a slot freed by a cancelled booking can be booked again.
      timeSlotId: { type: DataTypes.UUID, allowNull: false },
      // Shared by bookings created (and paid for) together in one checkout.
      checkoutId: { type: DataTypes.UUID, allowNull: true },
      sportCategoryId: { type: DataTypes.UUID, allowNull: false },
      // Where the session happens. Null on bookings made before courts existed.
      courtId: { type: DataTypes.UUID, allowNull: true },
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
      indexes: [{ fields: ['client_id'] }, { fields: ['coach_id'] }, { fields: ['status'] }, { fields: ['time_slot_id'] }, { fields: ['checkout_id'] }],
    }
  );

  return Booking;
};
