const { Op } = require('sequelize');
const { Court, Booking } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

const clean = (v) => (typeof v === 'string' ? v.trim() : v);

async function assertNameFree(name, exceptId) {
  const where = { name };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  if (await Court.findOne({ where })) throw ApiError.conflict('A court with this name already exists');
}

// GET /api/courts — active courts, for clients choosing where to train.
const listCourts = catchAsync(async (req, res) => {
  const courts = await Court.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'address'], order: [['name', 'ASC']] });
  sendResponse(res, 200, 'Courts retrieved', courts);
});

// GET /api/courts/all — admin: every court, with how many bookings use it.
const listAllCourts = catchAsync(async (req, res) => {
  const courts = await Court.findAll({ order: [['name', 'ASC']] });
  const counts = await Booking.findAll({
    attributes: ['courtId', [Booking.sequelize.fn('COUNT', Booking.sequelize.col('id')), 'n']],
    where: { courtId: { [Op.ne]: null } },
    group: ['courtId'],
    raw: true,
  });
  const byCourt = Object.fromEntries(counts.map((c) => [c.courtId, Number(c.n)]));
  sendResponse(res, 200, 'Courts retrieved', courts.map((c) => ({ ...c.toJSON(), bookingCount: byCourt[c.id] || 0 })));
});

// POST /api/courts — admin
const createCourt = catchAsync(async (req, res) => {
  const name = clean(req.body.name);
  await assertNameFree(name);
  const court = await Court.create({ name, address: clean(req.body.address) || null });
  sendResponse(res, 201, 'Court created', court);
});

// PUT /api/courts/:id — admin: rename, change address, or (de)activate.
const updateCourt = catchAsync(async (req, res) => {
  const court = await Court.findByPk(req.params.id);
  if (!court) throw ApiError.notFound('Court not found');
  const { isActive } = req.body;
  const name = clean(req.body.name);
  const address = clean(req.body.address);
  if (name !== undefined && name !== court.name) {
    await assertNameFree(name, court.id);
    court.name = name;
  }
  if (address !== undefined) court.address = address || null;
  if (isActive !== undefined) court.isActive = isActive;
  await court.save();
  sendResponse(res, 200, 'Court updated', court);
});

// DELETE /api/courts/:id — admin. Courts with bookings are kept so those
// bookings still say where they happened; deactivate them instead.
const deleteCourt = catchAsync(async (req, res) => {
  const court = await Court.findByPk(req.params.id);
  if (!court) throw ApiError.notFound('Court not found');
  const used = await Booking.count({ where: { courtId: court.id } });
  if (used) {
    throw ApiError.conflict(`${court.name} is used by ${used} booking${used === 1 ? '' : 's'}. Deactivate it instead so clients can't pick it.`);
  }
  await court.destroy();
  sendResponse(res, 200, 'Court deleted');
});

module.exports = { listCourts, listAllCourts, createCourt, updateCourt, deleteCourt };
