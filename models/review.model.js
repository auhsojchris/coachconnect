module.exports = (sequelize, DataTypes) => {
  const Review = sequelize.define(
    'Review',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      bookingId: { type: DataTypes.UUID, allowNull: false, unique: true },
      clientId: { type: DataTypes.UUID, allowNull: false },
      coachId: { type: DataTypes.UUID, allowNull: false },
      rating: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
      comment: { type: DataTypes.TEXT, allowNull: true },
      isApproved: { type: DataTypes.BOOLEAN, defaultValue: true },
      isFlagged: { type: DataTypes.BOOLEAN, defaultValue: false },
      flagReason: { type: DataTypes.STRING, allowNull: true },
    },
    {
      tableName: 'reviews',
      indexes: [{ fields: ['coach_id'] }, { fields: ['is_approved'] }],
    }
  );

  return Review;
};
