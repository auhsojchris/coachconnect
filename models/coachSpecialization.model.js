module.exports = (sequelize, DataTypes) => {
  const CoachSpecialization = sequelize.define(
    'CoachSpecialization',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      coachId: { type: DataTypes.UUID, allowNull: false },
      sportCategoryId: { type: DataTypes.UUID, allowNull: false },
      certification: { type: DataTypes.STRING, allowNull: true },
      yearsExperience: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    },
    {
      tableName: 'coach_specializations',
      indexes: [{ unique: true, fields: ['coach_id', 'sport_category_id'] }],
    }
  );

  return CoachSpecialization;
};
