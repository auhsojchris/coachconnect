const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sequelize, User, Role, Coach, ClientProfile } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sendResponse } = require('../utils/ApiResponse');
const { generateAccessToken, generatePasswordResetToken } = require('../utils/generateToken');
const { sendPasswordResetEmail } = require('../services/email.service');

// POST /api/auth/register
const register = catchAsync(async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  const existing = await User.findOne({ where: { email } });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const roleRecord = await Role.findOne({ where: { name: role } });
  if (!roleRecord) throw ApiError.badRequest('Invalid role');

  const user = await sequelize.transaction(async (t) => {
    const created = await User.create({ name, email, password, phone, roleId: roleRecord.id }, { transaction: t });

    if (role === 'coach') {
      await Coach.create({ userId: created.id, hourlyRate: 0 }, { transaction: t });
    } else if (role === 'client') {
      await ClientProfile.create({ userId: created.id }, { transaction: t });
    }

    return created;
  });

  user.role = roleRecord;
  const token = generateAccessToken(user);

  sendResponse(res, 201, 'Registration successful', { user: user.toSafeJSON(), token });
});

// POST /api/auth/login
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.scope('withPassword').findOne({
    where: { email },
    include: { model: Role, as: 'role' },
  });

  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw ApiError.forbidden('Account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save();

  const token = generateAccessToken(user);
  sendResponse(res, 200, 'Login successful', { user: user.toSafeJSON(), token });
});

// POST /api/auth/logout
// Stateless JWTs cannot be revoked server-side without a blocklist; the
// client is responsible for discarding the token. This endpoint exists for
// API symmetry and future blocklist support.
const logout = catchAsync(async (req, res) => {
  sendResponse(res, 200, 'Logged out successfully');
});

// POST /api/auth/forgot-password
const forgotPassword = catchAsync(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ where: { email } });

  // Always respond 200 regardless of whether the account exists, to avoid
  // leaking which emails are registered.
  if (user) {
    const resetToken = generatePasswordResetToken(user);
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    await sendPasswordResetEmail(user, resetToken);
  }

  sendResponse(res, 200, 'If an account with that email exists, a reset link has been sent');
});

// POST /api/auth/reset-password
const resetPassword = catchAsync(async (req, res) => {
  const { token, password } = req.body;

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_RESET_SECRET);
  } catch (err) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }
  if (payload.purpose !== 'password_reset') throw ApiError.badRequest('Invalid reset token');

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.scope('withPassword').findOne({
    where: { id: payload.sub, resetPasswordToken: hashedToken },
  });

  if (!user || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  user.password = password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  sendResponse(res, 200, 'Password has been reset successfully');
});

module.exports = { register, login, logout, forgotPassword, resetPassword };
