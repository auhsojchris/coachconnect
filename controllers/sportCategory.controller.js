const { SportCategory } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');

// GET /api/sport-categories — public
const listSportCategories = catchAsync(async (req, res) => {
  const categories = await SportCategory.findAll({ where: { isActive: true }, order: [['name', 'ASC']] });
  sendResponse(res, 200, 'Sport categories retrieved', categories);
});

// POST /api/sport-categories — admin
const createSportCategory = catchAsync(async (req, res) => {
  const { name, description, icon } = req.body;
  const existing = await SportCategory.findOne({ where: { name } });
  if (existing) throw ApiError.conflict('A sport category with this name already exists');

  const category = await SportCategory.create({ name, description, icon });
  sendResponse(res, 201, 'Sport category created', category);
});

// PUT /api/sport-categories/:id — admin
const updateSportCategory = catchAsync(async (req, res) => {
  const category = await SportCategory.findByPk(req.params.id);
  if (!category) throw ApiError.notFound('Sport category not found');

  const { name, description, icon, isActive } = req.body;
  if (name !== undefined) category.name = name;
  if (description !== undefined) category.description = description;
  if (icon !== undefined) category.icon = icon;
  if (isActive !== undefined) category.isActive = isActive;
  await category.save();

  sendResponse(res, 200, 'Sport category updated', category);
});

// DELETE /api/sport-categories/:id — admin
const deleteSportCategory = catchAsync(async (req, res) => {
  const category = await SportCategory.findByPk(req.params.id);
  if (!category) throw ApiError.notFound('Sport category not found');
  await category.destroy();
  sendResponse(res, 200, 'Sport category deleted');
});

module.exports = { listSportCategories, createSportCategory, updateSportCategory, deleteSportCategory };
