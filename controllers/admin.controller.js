const { Op } = require('sequelize');
const { sequelize, User, Role, Coach, ClientProfile, Booking, Payment, Review, TimeSlot } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

// Payment providers where the client's money landed with the platform, so
// the platform owes the coach their net share (payoutAmount).
const PLATFORM_HELD = ['paymongo', 'platform_qr'];

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
// ---- Overview analytics ------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
// Days are bucketed in Philippine time (UTC+8, no DST) so "today" matches
// what admins see on the wall clock.
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const localDay = (date) => new Date(new Date(date).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const ALLOWED_RANGES = [7, 30, 90];

/** Start (inclusive) of the local day `daysAgo` days before today, as a UTC Date. */
function startOfLocalDay(daysAgo) {
  const today = localDay(new Date());
  return new Date(new Date(`${today}T00:00:00Z`).getTime() - TZ_OFFSET_MS - daysAgo * DAY_MS);
}

/**
 * Period analytics for the admin Overview: totals for the selected range and
 * the same-length period before it (for "vs previous" deltas), a revenue
 * trend (daily for 7/30 days, weekly for 90), top coaches by revenue, and
 * counts of things waiting on an admin. Sums are done in JS over the
 * period's rows so it behaves the same on MySQL (dev) and Postgres (prod).
 */
async function buildOverview(days) {
  const start = startOfLocalDay(days - 1);
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  const now = new Date();

  const [payments, bookings, users, attentionQr, unverifiedCoaches, upcomingSessions] = await Promise.all([
    // paidAt can be missing on older rows; fall back to when the row was last updated.
    Payment.findAll({
      where: {
        status: 'paid',
        [Op.or]: [{ paidAt: { [Op.gte]: prevStart } }, { paidAt: null, updatedAt: { [Op.gte]: prevStart } }],
      },
      attributes: ['amount', 'platformFeeAmount', 'paidAt', 'updatedAt'],
      include: [{ model: Booking, as: 'booking', attributes: ['coachId'] }],
    }),
    Booking.findAll({ where: { createdAt: { [Op.gte]: prevStart } }, attributes: ['status', 'createdAt'] }),
    User.findAll({
      where: { createdAt: { [Op.gte]: prevStart } },
      attributes: ['createdAt'],
      include: [{ model: Role, as: 'role', attributes: ['name'] }],
    }),
    Payment.findAll({ where: { provider: 'platform_qr', status: 'submitted' }, attributes: ['amount'] }),
    Coach.count({ where: { isVerified: false } }),
    Booking.count({
      where: { status: 'confirmed' },
      include: [{
        model: TimeSlot,
        as: 'timeSlot',
        required: true,
        where: { date: { [Op.between]: [localDay(now), localDay(new Date(now.getTime() + 6 * DAY_MS))] } },
      }],
    }),
  ]);

  const inCurrent = (d) => new Date(d) >= start;
  const empty = () => ({ revenue: 0, commission: 0, bookings: 0, completedSessions: 0, newClients: 0, newCoaches: 0 });
  const current = empty();
  const previous = empty();

  // Trend buckets: one per day, or one per 7 days (oldest first) for 90 days.
  const bucketDays = days > 30 ? 7 : 1;
  const trend = [];
  for (let i = 0; i < days; i += bucketDays) {
    trend.push({ date: localDay(new Date(start.getTime() + i * DAY_MS)), days: Math.min(bucketDays, days - i), revenue: 0, bookings: 0 });
  }
  const bucketFor = (d) => trend[Math.min(trend.length - 1, Math.floor((new Date(d) - start) / DAY_MS / bucketDays))];

  const revenueByCoach = new Map();
  for (const p of payments) {
    const when = p.paidAt || p.updatedAt;
    const target = inCurrent(when) ? current : previous;
    target.revenue += Number(p.amount);
    target.commission += Number(p.platformFeeAmount || 0);
    if (target === current) {
      bucketFor(when).revenue += Number(p.amount);
      const coachId = p.booking?.coachId;
      if (coachId) {
        const row = revenueByCoach.get(coachId) || { coachId, revenue: 0, sessions: 0 };
        row.revenue += Number(p.amount);
        row.sessions += 1;
        revenueByCoach.set(coachId, row);
      }
    }
  }
  for (const b of bookings) {
    const target = inCurrent(b.createdAt) ? current : previous;
    target.bookings += 1;
    if (b.status === 'completed') target.completedSessions += 1;
    if (target === current) bucketFor(b.createdAt).bookings += 1;
  }
  for (const u of users) {
    const target = inCurrent(u.createdAt) ? current : previous;
    if (u.role?.name === 'client') target.newClients += 1;
    if (u.role?.name === 'coach') target.newCoaches += 1;
  }

  const top = [...revenueByCoach.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const coaches = top.length
    ? await Coach.findAll({ where: { id: top.map((t) => t.coachId) }, attributes: ['id', 'averageRating'], include: [{ model: User, as: 'user', attributes: ['name'] }] })
    : [];
  const coachById = new Map(coaches.map((c) => [c.id, c]));

  const round = (o) => ({ ...o, revenue: money(o.revenue), commission: money(o.commission) });
  return {
    range: days,
    since: localDay(start),
    current: round(current),
    previous: round(previous),
    trend: trend.map((t) => ({ ...t, revenue: money(t.revenue) })),
    topCoaches: top.map((t) => ({
      ...t,
      revenue: money(t.revenue),
      name: coachById.get(t.coachId)?.user?.name || 'Coach',
      averageRating: Number(coachById.get(t.coachId)?.averageRating || 0),
    })),
    attention: {
      qrPaymentsToVerify: attentionQr.length,
      qrAmountToVerify: money(attentionQr.reduce((s, p) => s + Number(p.amount), 0)),
      unverifiedCoaches,
    },
    upcomingSessions,
  };
}

const getDashboardStats = catchAsync(async (req, res) => {
  const range = ALLOWED_RANGES.includes(Number(req.query.range)) ? Number(req.query.range) : 30;
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
    verifiedCoaches,
    overview,
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
    Booking.findAll({
      limit: 8,
      order: [['createdAt', 'DESC']],
      include: [
        { model: User, as: 'client', attributes: ['id', 'name'] },
        { model: Coach, as: 'coach', attributes: ['id'], include: [{ model: User, as: 'user', attributes: ['id', 'name'] }] },
        { model: TimeSlot, as: 'timeSlot', attributes: ['date', 'startTime', 'endTime'] },
      ],
    }),
    Payment.sum('platformFeeAmount', { where: { provider: 'gcash', status: 'paid', platformFeeSettled: false } }),
    Payment.sum('payoutAmount', { where: { provider: { [Op.in]: PLATFORM_HELD }, status: 'paid', payoutSettled: false } }),
    // All-time platform commission across both GCash paths (manual and
    // PayMongo), regardless of settlement status — the total the platform
    // has earned, not just what's still outstanding.
    Payment.sum('platformFeeAmount', { where: { status: 'paid' } }),
    Coach.count({ where: { isVerified: true } }),
    buildOverview(range),
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
    verifiedCoaches,
    overview,
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

  const where = { provider: { [Op.in]: PLATFORM_HELD }, status: 'paid', payoutAmount: { [Op.ne]: null } };
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
  if (!PLATFORM_HELD.includes(payment.provider) || payment.payoutAmount === null) {
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

// GET /api/admin/qr-payments?status=submitted — client payments to the
// platform's QR, newest first. Confirm/reject go through the existing
// PUT /api/payments/:id/confirm-gcash and /reject-gcash endpoints, which
// resolve every session in the same checkout at once.
const listQrPayments = catchAsync(async (req, res) => {
  const { status = 'submitted', page = 1, limit = 50 } = req.query;
  const where = { provider: 'platform_qr' };
  if (status !== 'all') where.status = status;

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Payment.findAndCountAll({
    where,
    include: [
      {
        model: Booking,
        as: 'booking',
        include: [
          { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
          { model: Coach, as: 'coach', attributes: ['id'], include: [{ model: User, as: 'user', attributes: ['id', 'name'] }] },
          { model: TimeSlot, as: 'timeSlot', attributes: ['id', 'date', 'startTime', 'endTime'] },
        ],
      },
    ],
    limit: Number(limit),
    offset,
    distinct: true,
    order: [['updatedAt', 'DESC']],
  });

  sendResponse(res, 200, 'QR payments retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

module.exports = {
  listQrPayments,
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
