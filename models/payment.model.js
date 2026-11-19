module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    'Payment',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      bookingId: { type: DataTypes.UUID, allowNull: false, unique: true },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'usd' },
      status: {
        type: DataTypes.ENUM('pending', 'submitted', 'paid', 'refunded', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      provider: { type: DataTypes.STRING, allowNull: false, defaultValue: 'stripe' },
      stripePaymentIntentId: { type: DataTypes.STRING, allowNull: true },
      paymongoPaymentIntentId: { type: DataTypes.STRING, allowNull: true },
      gcashReference: { type: DataTypes.STRING, allowNull: true },
      receiptUrl: { type: DataTypes.STRING, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      // Platform commission on this payment.
      // - provider 'gcash' (manual): money went straight to the coach, so
      //   this is what the COACH owes the platform (platformFeeSettled).
      // - provider 'paymongo' (automatic): money went to the platform, so
      //   payoutAmount (amount - fee) is what the PLATFORM owes the coach
      //   (payoutSettled).
      platformFeeAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      platformFeeRate: { type: DataTypes.DECIMAL(5, 4), allowNull: true },
      platformFeeSettled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      payoutAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      payoutSettled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'payments',
      indexes: [{ fields: ['status'] }, { fields: ['stripe_payment_intent_id'] }, { fields: ['paymongo_payment_intent_id'] }],
    }
  );

  return Payment;
};
