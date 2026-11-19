const { Op } = require('sequelize');
const {
  sequelize,
  Coach,
  User,
  Role,
  SportCategory,
  CoachSpecialization,
  TimeSlot,
} = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

// Public-facing include: no email/phone. Those are PII and GET /coaches +
// GET /coaches/:id have no `authenticate` middleware, so anything listed
// here is scrapeable by anonymous visitors.
const publicCoachInclude = [
  { model: User, as: 'user', attributes: ['id', 'name', 'profileImage'] },
  {
    model: CoachSpecialization,
    as: 'specializations',
    include: [{ model: SportCategory, as: 'sportCategory' }],
  },
];

// Same reasoning as above, but for columns on the Coach row itself: the
// GCash number is only handed out via the payment flow (to a client with an
// actual booking) or to the coach's own authenticated profile, never here.
const publicCoachAttributes = { exclude: ['gcashNumber', 'gcashAccountName'] };

// GET /api/coaches — search & filter coaches
const listCoaches = catchAsync(async (req, res) => {
  const { sport, city, minPrice, maxPrice, minRating, date, page = 1, limit = 20 } = req.query;

  const where = {};
  if (city) where.city = { [Op.like]: `%${city}%` };
  if (minPrice || maxPrice) {
    where.hourlyRate = {};
    if (minPrice) where.hourlyRate[Op.gte] = minPrice;
    if (maxPrice) where.hourlyRate[Op.lte] = maxPrice;
  }
  if (minRating) where.averageRating = { [Op.gte]: minRating };

  const include = [...publicCoachInclude];
  if (sport) {
    include[1] = {
      ...include[1],
      required: true,
      include: [{ model: SportCategory, as: 'sportCategory', where: { name: { [Op.like]: `%${sport}%` } } }],
    };
  }
  if (date) {
    include.push({
      model: TimeSlot,
      as: 'timeSlots',
      required: true,
      where: { date, status: 'available' },
      attributes: ['id', 'date', 'startTime', 'endTime', 'status'],
    });
  }

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Coach.findAndCountAll({
    where,
    attributes: publicCoachAttributes,
    include,
    limit: Number(limit),
    offset,
    distinct: true,
    order: [['averageRating', 'DESC']],
  });

  sendResponse(res, 200, 'Coaches retrieved', rows, {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / Number(limit)),
  });
});

// GET /api/coaches/:id
const getCoachById = catchAsync(async (req, res) => {
  const coach = await Coach.findByPk(req.params.id, { attributes: publicCoachAttributes, include: publicCoachInclude });
  if (!coach) throw ApiError.notFound('Coach not found');
  sendResponse(res, 200, 'Coach retrieved', coach);
});

// POST /api/coaches — admin creates a coach profile for an existing user
const createCoach = catchAsync(async (req, res) => {
  const { userId, bio, experienceYears, hourlyRate, location, city, country } = req.body;

  const user = await User.findByPk(userId, { include: { model: Role, as: 'role' } });
  if (!user) throw ApiError.notFound('User not found');
  if (user.role.name !== 'coach') throw ApiError.badRequest('User does not have the coach role');

  const existing = await Coach.findOne({ where: { userId } });
  if (existing) throw ApiError.conflict('This user already has a coach profile');

  const coach = await Coach.create({ userId, bio, experienceYears, hourlyRate, location, city, country });
  sendResponse(res, 201, 'Coach profile created', coach);
});

function assertCanManageCoach(req, coach) {
  const isOwner = req.user.role.name === 'coach' && coach.userId === req.user.id;
  const isAdmin = req.user.role.name === 'admin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('You cannot modify this coach profile');
}

// PUT /api/coaches/:id
const updateCoach = catchAsync(async (req, res) => {
  const coach = await Coach.findByPk(req.params.id);
  if (!coach) throw ApiError.notFound('Coach not found');
  assertCanManageCoach(req, coach);

  const { bio, experienceYears, hourlyRate, location, city, country, gcashNumber, gcashAccountName, specializations } = req.body;

  await sequelize.transaction(async (t) => {
    if (bio !== undefined) coach.bio = bio;
    if (experienceYears !== undefined) coach.experienceYears = experienceYears;
    if (hourlyRate !== undefined) coach.hourlyRate = hourlyRate;
    if (location !== undefined) coach.location = location;
    if (city !== undefined) coach.city = city;
    if (country !== undefined) coach.country = country;
    if (gcashNumber !== undefined) coach.gcashNumber = gcashNumber;
    if (gcashAccountName !== undefined) coach.gcashAccountName = gcashAccountName;
    await coach.save({ transaction: t });

    if (Array.isArray(specializations)) {
      await CoachSpecialization.destroy({ where: { coachId: coach.id }, transaction: t });
      if (specializations.length) {
        await CoachSpecialization.bulkCreate(
          specializations.map((s) => ({
            coachId: coach.id,
            sportCategoryId: s.sportCategoryId,
            certification: s.certification,
            yearsExperience: s.yearsExperience,
          })),
          { transaction: t }
        );
      }
    }
  });

  const updated = await Coach.findByPk(coach.id, { include: publicCoachInclude });
  sendResponse(res, 200, 'Coach profile updated', updated);
});

// DELETE /api/coaches/:id — admin only
const deleteCoach = catchAsync(async (req, res) => {
  const coach = await Coach.findByPk(req.params.id);
  if (!coach) throw ApiError.notFound('Coach not found');
  await coach.destroy();
  sendResponse(res, 200, 'Coach profile deleted');
});

// POST /api/coaches/:id/image — upload profile image
const uploadProfileImage = catchAsync(async (req, res) => {
  const coach = await Coach.findByPk(req.params.id);
  if (!coach) throw ApiError.notFound('Coach not found');
  assertCanManageCoach(req, coach);
  if (!req.file) throw ApiError.badRequest('No image file provided');

  const user = await User.findByPk(coach.userId);
  user.profileImage = `/uploads/coaches/${req.file.filename}`;
  await user.save();

  sendResponse(res, 200, 'Profile image uploaded', { profileImage: user.profileImage });
});

module.exports = { listCoaches, getCoachById, createCoach, updateCoach, deleteCoach, uploadProfileImage };
