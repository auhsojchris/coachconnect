const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Normalizes any thrown error (ApiError, Sequelize error, JWT error, etc.)
// into a consistent JSON error envelope and picks an appropriate status code.
function errorHandler(err, req, res, next) {
  let error = err;

  if (error instanceof UniqueConstraintError) {
    error = ApiError.conflict('A record with these details already exists', error.errors?.map((e) => e.message));
  } else if (error instanceof ForeignKeyConstraintError) {
    // MySQL errno 1451 = delete/update blocked because other rows still
    // reference this one (RESTRICT); 1452 = the FK value given doesn't
    // point at an existing row. These need different, non-confusing messages.
    const errno = error.original?.errno || error.parent?.errno;
    error =
      errno === 1451
        ? ApiError.conflict('This record is still referenced by other data (e.g. bookings) and cannot be deleted')
        : ApiError.badRequest('Referenced resource does not exist');
  } else if (error instanceof ValidationError) {
    error = ApiError.badRequest(
      'Validation failed',
      error.errors.map((e) => e.message)
    );
  } else if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    error = ApiError.unauthorized('Invalid or expired token');
  } else if (!(error instanceof ApiError)) {
    logger.error(`${error.message}\n${error.stack}`);
    error = ApiError.internal(process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message);
  }

  if (error.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${error.statusCode}: ${error.message}`);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message,
    errors: error.errors && error.errors.length ? error.errors : undefined,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });
}

module.exports = { notFoundHandler, errorHandler };
