module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    'Role',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: {
        type: DataTypes.ENUM('admin', 'coach', 'client'),
        allowNull: false,
        unique: true,
      },
      description: { type: DataTypes.STRING },
    },
    { tableName: 'roles' }
  );

  return Role;
};
