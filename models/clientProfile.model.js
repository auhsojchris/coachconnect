module.exports = (sequelize, DataTypes) => {
  const ClientProfile = sequelize.define(
    'ClientProfile',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false, unique: true },
      dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true },
      gender: { type: DataTypes.ENUM('male', 'female', 'other', 'prefer_not_to_say'), allowNull: true },
      emergencyContact: { type: DataTypes.STRING, allowNull: true },
      fitnessGoals: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'client_profiles',
    }
  );

  return ClientProfile;
};
