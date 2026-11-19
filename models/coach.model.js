module.exports = (sequelize, DataTypes) => {
  const Coach = sequelize.define(
    'Coach',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false, unique: true },
      bio: { type: DataTypes.TEXT, allowNull: true },
      experienceYears: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
      hourlyRate: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      location: { type: DataTypes.STRING, allowNull: true },
      city: { type: DataTypes.STRING, allowNull: true },
      country: { type: DataTypes.STRING, allowNull: true },
      averageRating: { type: DataTypes.DECIMAL(3, 2), allowNull: false, defaultValue: 0 },
      totalReviews: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
      gcashNumber: { type: DataTypes.STRING, allowNull: true },
      gcashAccountName: { type: DataTypes.STRING, allowNull: true },
    },
    {
      tableName: 'coaches',
      indexes: [{ fields: ['city'] }, { fields: ['hourly_rate'] }, { fields: ['average_rating'] }],
    }
  );

  return Coach;
};
