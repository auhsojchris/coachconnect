module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    'Notification',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      type: {
        type: DataTypes.ENUM(
          'booking_confirmed',
          'booking_cancelled',
          'booking_rescheduled',
          'payment_received',
          'payment_failed',
          'session_reminder',
          'review_received',
          'general',
          'gcash_submitted',
          'payout_pending',
          'payment_submitted'
        ),
        allowNull: false,
      },
      title: { type: DataTypes.STRING, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
      metadata: { type: DataTypes.JSON, allowNull: true },
    },
    {
      tableName: 'notifications',
      indexes: [{ fields: ['user_id'] }, { fields: ['user_id', 'is_read'] }],
    }
  );

  return Notification;
};
