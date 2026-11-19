const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false, validate: { notEmpty: true, len: [2, 100] } },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
        set(value) {
          this.setDataValue('email', value.toLowerCase().trim());
        },
      },
      password: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: true },
      roleId: { type: DataTypes.UUID, allowNull: false },
      profileImage: { type: DataTypes.STRING, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
      emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
      resetPasswordToken: { type: DataTypes.STRING, allowNull: true },
      resetPasswordExpires: { type: DataTypes.DATE, allowNull: true },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
      stripeCustomerId: { type: DataTypes.STRING, allowNull: true },
      gcashNumber: { type: DataTypes.STRING, allowNull: true },
      gcashAccountName: { type: DataTypes.STRING, allowNull: true },
    },
    {
      tableName: 'users',
      indexes: [{ fields: ['role_id'] }],
      hooks: {
        beforeCreate: async (user) => {
          user.password = await bcrypt.hash(user.password, Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
        },
        beforeUpdate: async (user) => {
          if (user.changed('password')) {
            user.password = await bcrypt.hash(user.password, Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
          }
        },
      },
      defaultScope: {
        attributes: { exclude: ['password', 'resetPasswordToken', 'resetPasswordExpires'] },
      },
      scopes: {
        withPassword: { attributes: {} },
      },
    }
  );

  User.prototype.comparePassword = function comparePassword(candidate) {
    return bcrypt.compare(candidate, this.password);
  };

  User.prototype.toSafeJSON = function toSafeJSON() {
    const json = this.toJSON();
    delete json.password;
    delete json.resetPasswordToken;
    delete json.resetPasswordExpires;
    return json;
  };

  return User;
};
