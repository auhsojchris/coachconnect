const jwt = require('jsonwebtoken');
const { User, Role } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

/**
 * Verifies the Bearer JWT, loads the user (with role), and attaches it to
 * req.user. Rejects if the token is invalid/expired or the account is
 * deactivated.
 */
const authenticate = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Authentication token missing');
  }

  const token = header.split(' ')[1];
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  const user = await User.findByPk(payload.sub, { include: { model: Role, as: 'role' } });
  if (!user) throw ApiError.unauthorized('User no longer exists');
  if (!user.isActive) throw ApiError.forbidden('Account has been deactivated');

  req.user = user;
  next();
});

module.exports = authenticate;
