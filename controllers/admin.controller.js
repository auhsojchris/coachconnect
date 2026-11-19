const { Op } = require('sequelize');
const { sequelize, User, Role, Coach, ClientProfile, Booking, Payment, Review } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

// GET /api/admin/users
const listUsers = catchAsync(async (req, res) => {
  const { role, isActive, search, page = 1, limit = 20 } = req.query;

  const where = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where[Op.or] = [{ name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }];
  }

  const roleInclude = { model: Role, as: 'role' };
  if (role) roleInclude.where = { name: role };

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await User.findAndCountAll({
    where,
    include: [roleInclude],
    limit: Number(limit),
    offset,
    order: [['createdAt', 'DESC']],
  });

  sendResponse(res, 200, 'Users retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

// GET /api/admin/users/:id
const getUserById = catchAsync(async (req, res) => {
  const user = await User.findByPk(req.params.id, { include: { model: Role, as: 'role' } });
  if (!user) throw ApiError.notFound('User not found');
  sendResponse(res, 200, 'User retrieved', user);
});

// POST /api/admin/users — create a user and its role-specific profile
const createUser = catchAsync(async (req, res) => {
  const { name, email, password, phone, role } = req.body;
  const roleRecord = await Role.findOne({ where: { name: role } });
  if (!roleRecord) throw ApiError.badRequest('Invalid role');
  if (await User.findOne({ where: { email } })) throw ApiError.conflict('An account with this email already exists');

  const user = await sequelize.transaction(async (t) => {
    const created = await User.create({ name, email, password, phone, roleId: roleRecord.id }, { transaction: t });
    if (role === 'coach') await Coach.create({ userId: created.id, hourlyRate: 0 }, { transaction: t });
    if (role === 'client') await ClientProfile.create({ userId: created.id }, { transaction: t });
    return created;
  });

  user.role = roleRecord;
  sendResponse(res, 201, 'User created', user);
});

// PUT /api/admin/users/:id — activate/deactivate, edit basic details
const updateUser = catchAsync(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  const { name, phone, isActive, emailVerified, role } = req.body;
  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (isActive !== undefined) user.isActive = isActive;
  if (emailVerified !== undefined) user.emailVerified = emailVerified;
  if (role !== undefined) {
    const roleRecord = await Role.findOne({ where: { name: role } });
    if (!roleRecord) throw ApiError.badRequest('Invalid role');
    user.roleId = roleRecord.id;
    if (role === 'coach') await Coach.findOrCreate({ where: { userId: user.id }, defaults: { hourlyRate: 0 } });
    if (role === 'client') await ClientProfile.findOrCreate({ where: { userId: user.id } });
  }
  await user.save();

  const updated = await User.findByPk(user.id, { include: { model: Role, as: 'role' } });
  sendResponse(res, 200, 'User updated', updated);
});

// DELETE /api/admin/users/:id
const deleteUser = catchAsync(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  await user.destroy();
  sendResponse(res, 200, 'User deleted');
});

// PUT /api/admin/coaches/:id/verify
const verifyCoach = catchAsync(async (req, res) => {
  const coach = await Coach.findByPk(req.params.id);
  if (!coach) throw ApiError.notFound('Coach not found');

  coach.isVerified = req.body.isVerified !== undefined ? req.body.isVerified : true;
  await coach.save();

  sendResponse(res, 200, 'Coach verification status updated', coach);
});

// GET /api/admin/dashboard/stats
const getDashboardStats = catchAsync(async (req, res) => {
  const [
    totalUsers,
    totalCoaches,
    totalClients,
    bookingsByStatus,
    revenueResult,
    pendingReviews,
    recentBookings,
    commissionOwed,
    payoutOwed,
    totalCommissionEarned,
  ] = await Promise.all([
    User.count(),
    User.count({ include: { model: Role, as: 'role', where: { name: 'coach' } } }),
    User.count({ include: { model: Role, as: 'role', where: { name: 'client' } } }),
    Booking.findAll({
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['status'],
      raw: true,
    }),
    Payment.findOne({
      where: { status: 'paid' },
      attributes: [[sequelize.fn('SUM', sequelize.col('amount')), 'totalRevenue']],
      raw: true,
    }),
    Review.count({ where: { isFlagged: true } }),
    Booking.findAll({ limit: 10, order: [['createdAt', 'DESC']] }),
    Payment.sum('platformFeeAmount', { where: { provider: 'gcash', status: 'paid', platformFeeSettled: false } }),
    Payment.sum('payoutAmount', { where: { provider: 'paymongo', status: 'paid', payoutSettled: false } }),
    // All-time platform commission across both GCash paths (manual and
    // PayMongo), regardless of settlement status — the total the platform
    // has earned, not just what's still outstanding.
    Payment.sum('platformFeeAmount', { where: { status: 'paid' } }),
  ]);

  sendResponse(res, 200, 'Dashboard statistics retrieved', {
    totalUsers,
    totalCoaches,
    totalClients,
    bookingsByStatus: bookingsByStatus.reduce((acc, row) => ({ ...acc, [row.status]: Number(row.count) }), {}),
    totalRevenue: Number(revenueResult?.totalRevenue) || 0,
    reviewsPendingModeration: pendingReviews,
    recentBookings,
    gcashCommissionOwed: Number(commissionOwed) || 0,
    gcashPayoutOwed: Number(payoutOwed) || 0,
    totalCommissionEarned: Number(totalCommissionEarned) || 0,
  });
});

// GET /api/admin/gcash-commissions — platform fees owed by coaches on
// confirmed GCash payments (the money went straight to the coach, so this
// is a running balance to collect/settle outside the app, not an automatic
// deduction).
const listGcashCommissions = catchAsync(async (req, res) => {
  const { settled, page = 1, limit = 20 } = req.query;

  const where = { provider: 'gcash', status: 'paid', platformFeeAmount: { [Op.ne]: null } };
  if (settled !== undefined) where.platformFeeSettled = settled === 'true';

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Payment.findAndCountAll({
    where,
    include: [
      {
        model: Booking,
        as: 'booking',
        include: [
          { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
          { model: Coach, as: 'coach', include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }] },
        ],
      },
    ],
    limit: Number(limit),
    offset,
    order: [['paidAt', 'DESC']],
  });

  const totalOwed = await Payment.sum('platformFeeAmount', { where: { ...where, platformFeeSettled: false } });

  sendResponse(res, 200, 'GCash commissions retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
    totalOwed: totalOwed || 0,
  });
});

// PUT /api/admin/gcash-commissions/:paymentId/settle — mark a coach's owed
// commission as collected outside the app.
const settleGcashCommission = catchAsync(async (req, res) => {
  const payment = await Payment.findByPk(req.params.paymentId);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.provider !== 'gcash' || payment.platformFeeAmount === null) {
    throw ApiError.badRequest('This payment has no platform commission to settle');
  }
  payment.platformFeeSettled = req.body.settled !== undefined ? req.body.settled : true;
  await payment.save();
  sendResponse(res, 200, 'Commission settlement updated', payment);
});

// GET /api/admin/gcash-payouts — coaches' net shares owed by the platform on
// automatic (PayMongo) GCash payments, which the platform actually holds.
const listGcashPayouts = catchAsync(async (req, res) => {
  const { settled, page = 1, limit = 20 } = req.query;

  const where = { provider: 'paymongo', status: 'paid', payoutAmount: { [Op.ne]: null } };
  if (settled !== undefined) where.payoutSettled = settled === 'true';

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Payment.findAndCountAll({
    where,
    include: [
      {
        model: Booking,
        as: 'booking',
        include: [
          { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
          {
            model: Coach,
            as: 'coach',
            attributes: ['id', 'gcashNumber', 'gcashAccountName'],
            include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
          },
        ],
      },
    ],
    limit: Number(limit),
    offset,
    order: [['paidAt', 'DESC']],
  });

  const totalOwed = await Payment.sum('payoutAmount', { where: { ...where, payoutSettled: false } });

  sendResponse(res, 200, 'GCash payouts retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
    totalOwed: totalOwed || 0,
  });
});

// PUT /api/admin/gcash-payouts/:paymentId/settle — mark a coach's payout as
// sent to them (outside the app — PayMongo's standard API has no third-party
// disbursement product).
const settleGcashPayout = catchAsync(async (req, res) => {
  const payment = await Payment.findByPk(req.params.paymentId);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.provider !== 'paymongo' || payment.payoutAmount === null) {
    throw ApiError.badRequest('This payment has no coach payout to settle');
  }
  payment.payoutSettled = req.body.settled !== undefined ? req.body.settled : true;
  await payment.save();
  sendResponse(res, 200, 'Payout settlement updated', payment);
});

// GET /api/admin/reviews — moderation queue (all reviews, optionally filtered)
const listReviews = catchAsync(async (req, res) => {
  const { flagged, approved, page = 1, limit = 20 } = req.query;

  const where = {};
  if (flagged !== undefined) where.isFlagged = flagged === 'true';
  if (approved !== undefined) where.isApproved = approved === 'true';

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Review.findAndCountAll({
    where,
    include: [
      { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
      { model: Coach, as: 'coach', include: [{ model: User, as: 'user', attributes: ['id', 'name'] }] },
    ],
    limit: Number(limit),
    offset,
    order: [['createdAt', 'DESC']],
  });

  sendResponse(res, 200, 'Reviews retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  verifyCoach,
  getDashboardStats,
  listReviews,
  listGcashCommissions,
  settleGcashCommission,
  listGcashPayouts,
  settleGcashPayout,
};
