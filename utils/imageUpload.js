const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

// On Vercel, uploads go to Vercel Blob since the serverless filesystem isn't
// persistent; the connected Blob store authenticates via the runtime's OIDC
// token (no static BLOB_READ_WRITE_TOKEN needed). Locally, off Vercel, files
// are written to disk under uploads/coaches as before.
async function uploadImage(file) {
  const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;

  if (process.env.VERCEL) {
    const { put } = require('@vercel/blob');
    const blob = await put(`coaches/${uniqueName}`, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
    });
    return blob.url;
  }

  const dir = path.join(process.cwd(), process.env.UPLOAD_PATH || 'uploads/coaches');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, uniqueName), file.buffer);
  return `/uploads/coaches/${uniqueName}`;
}

module.exports = { uploadImage };
