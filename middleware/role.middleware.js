const ApiError = require('../utils/ApiError');

/**
 * Role-based access control. Usage: authorize('admin'), authorize('admin', 'coach').
 * Must run after the `authenticate` middleware.
 */
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !req.user.role) {
    return next(ApiError.unauthorized('Authentication required'));
  }
  if (!allowedRoles.includes(req.user.role.name)) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  next();
};

module.exports = authorize;
