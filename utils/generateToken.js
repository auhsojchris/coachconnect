const jwt = require('jsonwebtoken');

function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role ? user.role.name : undefined },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
}

function generatePasswordResetToken(user) {
  return jwt.sign({ sub: user.id, purpose: 'password_reset' }, process.env.JWT_RESET_SECRET, {
    expiresIn: process.env.JWT_RESET_EXPIRES_IN || '15m',
  });
}

module.exports = { generateAccessToken, generatePasswordResetToken };
