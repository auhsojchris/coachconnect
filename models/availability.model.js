module.exports = (sequelize, DataTypes) => {
  const Availability = sequelize.define(
    'Availability',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      coachId: { type: DataTypes.UUID, allowNull: false },
      // 0 = Sunday ... 6 = Saturday. Used for recurring weekly windows.
      dayOfWeek: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0, max: 6 } },
      startTime: { type: DataTypes.TIME, allowNull: false },
      endTime: { type: DataTypes.TIME, allowNull: false },
      isRecurring: { type: DataTypes.BOOLEAN, defaultValue: true },
      // Used instead of dayOfWeek for one-off availability windows.
      specificDate: { type: DataTypes.DATEONLY, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    {
      tableName: 'availabilities',
      indexes: [{ fields: ['coach_id'] }, { fields: ['coach_id', 'day_of_week'] }],
      validate: {
        eitherRecurringOrSpecific() {
          if (this.isRecurring && this.dayOfWeek === null) {
            throw new Error('dayOfWeek is required for recurring availability');
          }
          if (!this.isRecurring && !this.specificDate) {
            throw new Error('specificDate is required for non-recurring availability');
          }
        },
        endAfterStart() {
          if (this.startTime && this.endTime && this.startTime >= this.endTime) {
            throw new Error('endTime must be after startTime');
          }
        },
      },
    }
  );

  return Availability;
};
