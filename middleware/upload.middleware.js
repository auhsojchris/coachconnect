const multer = require('multer');
const ApiError = require('../utils/ApiError');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Memory storage: the serverless deployment has no writable persistent disk,
// so uploaded files are buffered in memory and handed to utils/imageUpload.js,
// which puts them in Vercel Blob (or local disk when running outside Vercel).
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(ApiError.badRequest('Only JPEG, PNG, or WEBP images are allowed'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: (Number(process.env.MAX_FILE_UPLOAD_MB) || 5) * 1024 * 1024 },
});

module.exports = upload;
