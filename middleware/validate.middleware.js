const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

/**
 * Runs after an express-validator chain array and short-circuits the
 * request with a 400 if any validation rule failed.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(ApiError.badRequest('Validation failed', errors.array().map((e) => e.msg)));
  }
  next();
};

module.exports = validate;
