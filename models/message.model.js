module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    'Message',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      senderId: { type: DataTypes.UUID, allowNull: false },
      recipientId: { type: DataTypes.UUID, allowNull: false },
      bookingId: { type: DataTypes.UUID, allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false, validate: { notEmpty: true, len: [1, 2000] } },
      isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'messages',
      indexes: [{ fields: ['booking_id', 'created_at'] }, { fields: ['recipient_id', 'is_read'] }],
    }
  );
};