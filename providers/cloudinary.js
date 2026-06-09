/**
 * Cloudinary storage provider
 *
 * Extracted from mediaStorage.js — keeps the same upload/delete behaviour
 * for backward compatibility with existing Cloudinary assets.
 */

const path = require('path');
const { PassThrough } = require('stream');
const { v2: cloudinary } = require('cloudinary');
const { getCloudinaryConfig } = require('../config/storage');

let initialized = false;

/**
 * Initialise the Cloudinary SDK once with credentials from the environment.
 */
function ensureInitialized() {
  if (initialized) return;

  const config = getCloudinaryConfig();

  if (config.configured) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret
    });
  }

  initialized = true;
}

/**
 * Throw if Cloudinary is not configured.
 */
function ensureConfigured() {
  ensureInitialized();

  const config = getCloudinaryConfig();

  if (!config.configured) {
    throw new Error('Cloudinary is not configured on the server.');
  }
}

/**
 * Sanitize a filename — keep only word chars and hyphens.
 */
function sanitizeFilename(filename = 'file') {
  const parsed = path.parse(filename);
  const sanitized = parsed.name
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return sanitized || 'file';
}

/**
 * Upload a multer memory buffer to Cloudinary.
 *
 * @param {object} file        — multer file object { buffer, originalname, mimetype }
 * @param {object} options
 * @param {string} options.folder        — Cloudinary folder path
 * @param {string} options.resourceType  — 'auto' (default), 'image', 'raw', 'video'
 * @returns {Promise<object>} Cloudinary upload result (includes secure_url, public_id, etc.)
 */
function upload(file, options = {}) {
  ensureConfigured();

  const folder = options.folder || getCloudinaryConfig().uploadFolder;
  const resourceType = options.resourceType || 'auto';

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        filename_override: sanitizeFilename(file.originalname)
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        // Ensure common fields are always present for backward compat
        return resolve({
          ...result,
          secure_url: result.secure_url || result.url || '',
          path: result.secure_url || result.url || result.path || '',
          storageKey: result.public_id || ''
        });
      }
    );

    const bufferStream = new PassThrough();
    bufferStream.end(file.buffer);
    bufferStream.pipe(uploadStream);
  });
}

/**
 * Extract the Cloudinary public_id from a stored URL.
 *
 * Handles URLs like:
 *   https://res.cloudinary.com/{cloud}/image/upload/v123456/FOLDER/filename.jpg
 *
 * @param {string} storedPath — full Cloudinary URL or public_id
 * @returns {string|null} public_id or null
 */
function extractCloudinaryPublicId(storedPath) {
  if (!storedPath || typeof storedPath !== 'string' || !storedPath.includes('/upload/')) {
    return null;
  }

  // If it doesn't look like a full URL, treat it as a raw public_id
  if (!storedPath.includes('res.cloudinary.com') && !storedPath.startsWith('http')) {
    // Could be a bare public_id — strip any file extension
    return storedPath.replace(/\.[^.]+$/, '');
  }

  const [pathWithoutQuery] = storedPath.split('?');
  const uploadSection = pathWithoutQuery.split('/upload/')[1];

  if (!uploadSection) {
    return null;
  }

  const segments = uploadSection.split('/');
  const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
  const publicIdSegments = versionIndex >= 0 ? segments.slice(versionIndex + 1) : segments;

  if (publicIdSegments.length === 0) {
    return null;
  }

  const lastSegment = publicIdSegments.pop();
  publicIdSegments.push(lastSegment.replace(/\.[^.]+$/, ''));

  return publicIdSegments.join('/');
}

/**
 * Extract a storage key from a Cloudinary URL (alias for extractCloudinaryPublicId).
 *
 * @param {string} storedPath
 * @returns {string|null}
 */
function extractStorageKey(storedPath) {
  return extractCloudinaryPublicId(storedPath);
}

/**
 * Delete an asset from Cloudinary by URL or public_id.
 *
 * @param {string} storedPath — Cloudinary URL or public_id
 * @returns {Promise<boolean>} true if deleted
 */
async function deleteAsset(storedPath) {
  const publicId = extractCloudinaryPublicId(storedPath);

  if (!publicId) {
    return false;
  }

  ensureConfigured();

  const resourceTypes = ['image', 'raw', 'video'];

  for (const resourceType of resourceTypes) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        invalidate: true,
        resource_type: resourceType
      });

      if (result.result === 'ok') {
        return true;
      }
    } catch (_err) {
      // Try next resource type
    }
  }

  return false;
}

module.exports = {
  upload,
  delete: deleteAsset,
  extractStorageKey,
  extractCloudinaryPublicId
};
