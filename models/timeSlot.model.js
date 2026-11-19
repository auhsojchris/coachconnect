module.exports = (sequelize, DataTypes) => {
  const TimeSlot = sequelize.define(
    'TimeSlot',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      coachId: { type: DataTypes.UUID, allowNull: false },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      startTime: { type: DataTypes.TIME, allowNull: false },
      endTime: { type: DataTypes.TIME, allowNull: false },
      // available -> booked (on confirmed booking) -> available again on cancellation.
      // blocked is used by coaches to manually close a slot off.
      status: {
        type: DataTypes.ENUM('available', 'booked', 'blocked'),
        allowNull: false,
        defaultValue: 'available',
      },
    },
    {
      tableName: 'time_slots',
      indexes: [
        // The core anti-double-booking guarantee at the database layer.
        { unique: true, fields: ['coach_id', 'date', 'start_time'] },
        { fields: ['coach_id', 'date', 'status'] },
      ],
      validate: {
        endAfterStart() {
          if (this.startTime && this.endTime && this.startTime >= this.endTime) {
            throw new Error('endTime must be after startTime');
          }
        },
      },
    }
  );

  return TimeSlot;
};
