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

/** Monday (YYYY-MM-DD, Philippine time) of the week a moment falls in. */
function localWeekStart(date) {
  const day = new Date(`${localDay(date)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const PAYOUT_STATUSES = ['owed', 'settled', 'all'];
const PAYOUT_PERIODS = { 4: 4, 12: 12 }; // weeks; anything else = all time

// GET /api/admin/payouts/weekly — coaches' net shares grouped into weekly
// statements (Mon–Sun, by paid date), one line per coach per week, so the
// admin sends each coach one transfer per week.
//   ?status=owed|settled|all (default owed)  ?weeks=4|12 (default all time)
const listWeeklyPayouts = catchAsync(async (req, res) => {
  const status = PAYOUT_STATUSES.includes(req.query.status) ? req.query.status : 'owed';
  const weeks = PAYOUT_PERIODS[req.query.weeks] || null;

  const payments = await Payment.findAll({
    where: { provider: { [Op.in]: PLATFORM_HELD }, status: 'paid', payoutAmount: { [Op.ne]: null } },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['id'],
      include: [
        { model: User, as: 'client', attributes: ['id', 'name'] },
        { model: TimeSlot, as: 'timeSlot', attributes: ['date', 'startTime', 'endTime'] },
        {
          model: Coach,
          as: 'coach',
          attributes: ['id', 'gcashNumber', 'gcashAccountName'],
          include: [{ model: User, as: 'user', attributes: ['name', 'email'] }],
        },
      ],
    }],
  });

  const cutoff = weeks ? addDays(localWeekStart(new Date()), -7 * (weeks - 1)) : null;
  const summary = { owed: 0, settled: 0, coachesOwed: new Set(), oldestOwedWeek: null };
  const weekMap = new Map();

  for (const p of payments) {
    const paidAt = p.paidAt || p.updatedAt;
    const weekStart = localWeekStart(paidAt);
    if (cutoff && weekStart < cutoff) continue;
    const net = money(p.payoutAmount);
    const coach = p.booking?.coach;
    if (p.payoutSettled) summary.settled += net;
    else {
      summary.owed += net;
      if (coach) summary.coachesOwed.add(coach.id);
      if (!summary.oldestOwedWeek || weekStart < summary.oldestOwedWeek) summary.oldestOwedWeek = weekStart;
    }

    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, { weekStart, weekEnd: addDays(weekStart, 6), total: 0, owed: 0, settled: 0, coaches: new Map() });
    }
    const week = weekMap.get(weekStart);
    const coachKey = coach?.id || 'unknown';
    if (!week.coaches.has(coachKey)) {
      week.coaches.set(coachKey, {
        coachId: coach?.id || null,
        name: coach?.user?.name || 'Unknown coach',
        email: coach?.user?.email || null,
        gcashNumber: coach?.gcashNumber || null,
        gcashAccountName: coach?.gcashAccountName || null,
        sessions: 0, gross: 0, commission: 0, net: 0, owed: 0, settled: 0, items: [],
      });
    }
    const line = week.coaches.get(coachKey);
    line.sessions += 1;
    line.gross += money(p.amount);
    line.commission += money(p.platformFeeAmount);
    line.net += net;
    line[p.payoutSettled ? 'settled' : 'owed'] += net;
    week.total += net;
    week[p.payoutSettled ? 'settled' : 'owed'] += net;
    line.items.push({
      paymentId: p.id,
      client: p.booking?.client?.name || null,
      sessionDate: p.booking?.timeSlot?.date || null,
      startTime: p.booking?.timeSlot?.startTime?.slice(0, 5) || null,
      paidAt,
      provider: p.provider,
      amount: money(p.amount),
      commission: money(p.platformFeeAmount),
      net,
      settled: !!p.payoutSettled,
    });
  }

  const keep = (owed, settled) => (status === 'owed' ? owed > 0 : status === 'settled' ? settled > 0 : true);
  const result = [...weekMap.values()]
    .map((w) => {
      const coaches = [...w.coaches.values()]
        .filter((c) => keep(c.owed, c.settled))
        .map((c) => ({
          ...c,
          gross: money(c.gross), commission: money(c.commission), net: money(c.net), owed: money(c.owed), settled: money(c.settled),
          status: c.owed === 0 ? 'settled' : c.settled === 0 ? 'owed' : 'partial',
          items: c.items.sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt)),
        }))
        .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
      return { ...w, total: money(w.total), owed: money(w.owed), settled: money(w.settled), coaches };
    })
    .filter((w) => w.coaches.length)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));

  sendResponse(res, 200, 'Weekly payouts retrieved', {
    status,
    weeks: weeks || 'all',
    summary: {
      owed: money(summary.owed),
      settled: money(summary.settled),
      coachesOwed: summary.coachesOwed.size,
      oldestOwedWeek: summary.oldestOwedWeek,
    },
    statements: result,
  });
});

// PUT /api/admin/payouts/settle — mark several payouts settled (or not) at
// once, e.g. a coach's whole week after sending one transfer.
const settlePayouts = catchAsync(async (req, res) => {
  const { paymentIds } = req.body;
  const settled = req.body.settled !== undefined ? req.body.settled : true;
  const payments = await Payment.findAll({ where: { id: { [Op.in]: paymentIds } } });
  if (payments.length !== new Set(paymentIds).size) throw ApiError.notFound('One or more payments were not found');
  if (payments.some((p) => !PLATFORM_HELD.includes(p.provider) || p.status !== 'paid' || p.payoutAmount === null)) {
    throw ApiError.badRequest('One or more payments have no coach payout to settle');
  }
  await Payment.update({ payoutSettled: settled }, { where: { id: { [Op.in]: paymentIds } } });
  sendResponse(res, 200, 'Payout settlement updated', {
    updated: payments.length,
    settled,
    amount: money(payments.reduce((s, p) => s + Number(p.payoutAmount), 0)),
  });
});

const FINANCE_DAYS = [7, 30, 90];
const parseDays = (v) => (FINANCE_DAYS.includes(Number(v)) ? Number(v) : null); // null = all time
const paidMoment = (p) => p.paidAt || p.updatedAt;
const includesText = (q, ...fields) => !q || fields.some((f) => f && String(f).toLowerCase().includes(q));

/** Every successful client payment (optionally since `days` ago), newest first, with who/what. */
async function fetchPaidPayments(days, extraWhere = {}) {
  const payments = await Payment.findAll({
    where: { status: 'paid', ...extraWhere },
    include: [{
      model: Booking,
      as: 'booking',
      attributes: ['id', 'checkoutId', 'status'],
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
        { model: TimeSlot, as: 'timeSlot', attributes: ['date', 'startTime'] },
        { model: Coach, as: 'coach', attributes: ['id'], include: [{ model: User, as: 'user', attributes: ['name', 'email'] }] },
      ],
    }],
  });
  const since = days ? startOfLocalDay(days - 1) : null;
  return payments
    .filter((p) => !since || new Date(paidMoment(p)) >= since)
    .sort((a, b) => new Date(paidMoment(b)) - new Date(paidMoment(a)));
}

// GET /api/admin/payments — successful client payments. Sessions bought in
// one checkout are one transaction.
//   ?days=7|30|90 (default all)  ?method=<provider>  ?search=  ?page= ?limit=
const listPaidPayments = catchAsync(async (req, res) => {
  const days = parseDays(req.query.days);
  const method = req.query.method || null;
  const q = (req.query.search || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const payments = await fetchPaidPayments(days);
  const groups = new Map();
  const methods = new Map();
  for (const p of payments) {
    const m = methods.get(p.provider) || { method: p.provider, transactions: new Set(), amount: 0 };
    const key = p.booking?.checkoutId || p.id;
    m.transactions.add(key);
    m.amount += money(p.amount);
    methods.set(p.provider, m);

    if (method && p.provider !== method) continue;
    const b = p.booking;
    if (!includesText(q, b?.client?.name, b?.client?.email, b?.coach?.user?.name, p.gcashReference, p.paymongoPaymentIntentId)) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        paidAt: paidMoment(p),
        method: p.provider,
        reference: p.gcashReference || p.paymongoPaymentIntentId || p.stripePaymentIntentId || null,
        receiptUrl: p.receiptUrl || null,
        client: b?.client ? { name: b.client.name, email: b.client.email } : null,
        coach: b?.coach?.user ? { name: b.coach.user.name } : null,
        amount: 0,
        commission: 0,
        sessions: [],
      });
    }
    const g = groups.get(key);
    g.amount += money(p.amount);
    g.commission += money(p.platformFeeAmount);
    g.sessions.push({ paymentId: p.id, date: b?.timeSlot?.date || null, startTime: b?.timeSlot?.startTime?.slice(0, 5) || null, amount: money(p.amount), bookingStatus: b?.status || null });
  }

  const all = [...groups.values()].map((g) => ({
    ...g,
    amount: money(g.amount),
    commission: money(g.commission),
    sessions: g.sessions.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)),
  }));
  const total = all.length;

  sendResponse(res, 200, 'Payments retrieved', {
    days: days || 'all',
    summary: {
      transactions: total,
      sessions: all.reduce((s, g) => s + g.sessions.length, 0),
      amount: money(all.reduce((s, g) => s + g.amount, 0)),
      commission: money(all.reduce((s, g) => s + g.commission, 0)),
      byMethod: [...methods.values()]
        .map((m) => ({ method: m.method, transactions: m.transactions.size, amount: money(m.amount) }))
        .sort((a, b) => b.amount - a.amount),
    },
    transactions: all.slice((page - 1) * limit, page * limit),
  }, { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});

// GET /api/admin/commissions — platform commission per coach, with every
// record. Commission on money the platform collected (QR / PayMongo) was
// kept automatically; on direct-to-coach GCash it's owed by the coach until
// an admin marks it collected.
//   ?days=7|30|90 (default all)  ?status=all|owed (default all)  ?search=
const listCommissionsByCoach = catchAsync(async (req, res) => {
  const days = parseDays(req.query.days);
  const onlyOwed = req.query.status === 'owed';
  const q = (req.query.search || '').trim().toLowerCase();

  const payments = await fetchPaidPayments(days, { platformFeeAmount: { [Op.ne]: null } });
  const coaches = new Map();
  const summary = { commission: 0, collected: 0, owed: 0, gross: 0 };

  for (const p of payments) {
    const b = p.booking;
    const fee = money(p.platformFeeAmount);
    const heldByPlatform = PLATFORM_HELD.includes(p.provider);
    const collected = heldByPlatform || !!p.platformFeeSettled;
    summary.commission += fee;
    summary.gross += money(p.amount);
    summary[collected ? 'collected' : 'owed'] += fee;

    if (onlyOwed && collected) continue;
    if (!includesText(q, b?.coach?.user?.name, b?.coach?.user?.email)) continue;
    const key = b?.coach?.id || 'unknown';
    if (!coaches.has(key)) {
      coaches.set(key, {
        coachId: b?.coach?.id || null,
        name: b?.coach?.user?.name || 'Unknown coach',
        email: b?.coach?.user?.email || null,
        sessions: 0, gross: 0, commission: 0, collected: 0, owed: 0, lastPaidAt: null, records: [],
      });
    }
    const c = coaches.get(key);
    c.sessions += 1;
    c.gross += money(p.amount);
    c.commission += fee;
    c[collected ? 'collected' : 'owed'] += fee;
    if (!c.lastPaidAt) c.lastPaidAt = paidMoment(p); // payments are newest first
    c.records.push({
      paymentId: p.id,
      paidAt: paidMoment(p),
      client: b?.client?.name || null,
      sessionDate: b?.timeSlot?.date || null,
      startTime: b?.timeSlot?.startTime?.slice(0, 5) || null,
      method: p.provider,
      amount: money(p.amount),
      rate: p.platformFeeRate !== null && p.platformFeeRate !== undefined ? Number(p.platformFeeRate) : null,
      commission: fee,
      heldByPlatform,
      collected,
    });
  }

  const list = [...coaches.values()]
    .map((c) => ({ ...c, gross: money(c.gross), commission: money(c.commission), collected: money(c.collected), owed: money(c.owed) }))
    .sort((a, b) => b.owed - a.owed || b.commission - a.commission || a.name.localeCompare(b.name));

  sendResponse(res, 200, 'Commissions retrieved', {
    days: days || 'all',
    status: onlyOwed ? 'owed' : 'all',
    summary: {
      gross: money(summary.gross),
      commission: money(summary.commission),
      collected: money(summary.collected),
      owed: money(summary.owed),
      coachesOwing: new Set(payments.filter((p) => !PLATFORM_HELD.includes(p.provider) && !p.platformFeeSettled).map((p) => p.booking?.coach?.id)).size,
    },
    coaches: list,
  });
});

// PUT /api/admin/commissions/settle — mark direct-GCash commissions as
// collected from the coach (or undo), several at once.
const settleCommissions = catchAsync(async (req, res) => {
  const { paymentIds } = req.body;
  const settled = req.body.settled !== undefined ? req.body.settled : true;
  const payments = await Payment.findAll({ where: { id: { [Op.in]: paymentIds } } });
  if (payments.length !== new Set(paymentIds).size) throw ApiError.notFound('One or more payments were not found');
  if (payments.some((p) => p.provider !== 'gcash' || p.status !== 'paid' || p.platformFeeAmount === null)) {
    throw ApiError.badRequest('Only commissions on direct GCash payments need collecting');
  }
  await Payment.update({ platformFeeSettled: settled }, { where: { id: { [Op.in]: paymentIds } } });
  sendResponse(res, 200, 'Commission settlement updated', {
    updated: payments.length,
    settled,
    amount: money(payments.reduce((s, p) => s + Number(p.platformFeeAmount), 0)),
  });
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
  listWeeklyPayouts,
  settlePayouts,
  listPaidPayments,
  listCommissionsByCoach,
  settleCommissions,
};
