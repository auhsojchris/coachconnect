const { User, Role, ClientProfile, Coach, CoachSpecialization, SportCategory } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');
const { uploadImage } = require('../utils/imageUpload');

const profileInclude = [
  { model: Role, as: 'role' },
  { model: ClientProfile, as: 'clientProfile' },
  {
    model: Coach,
    as: 'coachProfile',
    include: [{ model: CoachSpecialization, as: 'specializations', include: [{ model: SportCategory, as: 'sportCategory' }] }],
  },
];

// GET /api/users/profile
const getProfile = catchAsync(async (req, res) => {
  const user = await User.findByPk(req.user.id, { include: profileInclude });
  sendResponse(res, 200, 'Profile retrieved', user);
});

// PUT /api/users/profile
const updateProfile = catchAsync(async (req, res) => {
  const { name, phone, dateOfBirth, gender, emergencyContact, fitnessGoals, gcashNumber, gcashAccountName } = req.body;

  const user = await User.findByPk(req.user.id);
  if (!user) throw ApiError.notFound('User not found');

  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  // Only meaningful for admins: coaches who owe platform commission need to
  // know where to send it.
  if (req.user.role.name === 'admin') {
    if (gcashNumber !== undefined) user.gcashNumber = gcashNumber;
    if (gcashAccountName !== undefined) user.gcashAccountName = gcashAccountName;
  }
  await user.save();

  if (req.user.role.name === 'client') {
    const [profile] = await ClientProfile.findOrCreate({ where: { userId: user.id } });
    if (dateOfBirth !== undefined) profile.dateOfBirth = dateOfBirth;
    if (gender !== undefined) profile.gender = gender;
    if (emergencyContact !== undefined) profile.emergencyContact = emergencyContact;
    if (fitnessGoals !== undefined) profile.fitnessGoals = fitnessGoals;
    await profile.save();
  }

  const updated = await User.findByPk(user.id, { include: profileInclude });

  sendResponse(res, 200, 'Profile updated', updated);
});

// POST /api/users/profile/image
const uploadProfileImage = catchAsync(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image file provided');

  const user = await User.findByPk(req.user.id);
  if (!user) throw ApiError.notFound('User not found');
  user.profileImage = await uploadImage(req.file);
  await user.save();

  sendResponse(res, 200, 'Profile image uploaded', { profileImage: user.profileImage });
});

module.exports = { getProfile, updateProfile, uploadProfileImage };
