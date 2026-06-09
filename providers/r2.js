/**
 * Cloudflare R2 storage provider (S3-compatible API)
 *
 * Uses @aws-sdk/client-s3 to upload / delete objects in an R2 bucket.
 * Public URLs are served via the configured custom domain (R2_PUBLIC_BASE_URL).
 *
 * Object key format:
 *   {R2_KEY_PREFIX}/{category}[/{orgId}[/{subfolder}]]/{uuid}.{ext}
 *
 * Examples:
 *   arams/users/a1b2c3d4.jpg
 *   arams/organizations/{orgId}/form-instances/{instanceId}/e5f6g7h8.png
 *   arams/organizations/{orgId}/branding/logo/i9j0k1l2.png
 */

const crypto = require('crypto');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getR2Config } = require('../config/storage');

// ---------------------------------------------------------------------------
// Lazy S3 client — only created when the R2 provider is actually used
// ---------------------------------------------------------------------------
let s3Client = null;

/**
 * Return (and cache) an S3Client pointed at the R2 endpoint.
 */
function getClient() {
  if (s3Client) return s3Client;

  const config = getR2Config();

  if (!config.configured) {
    throw new Error(
      `R2 is not fully configured. Missing: ${config.missingVars.join(', ')}`
    );
  }

  s3Client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    // R2 requires path-style addressing (not virtual-hosted)
    forcePathStyle: true
  });

  return s3Client;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Sanitize a single path component — keep only word chars and hyphens.
 * Dots and slashes are stripped/replaced to prevent path traversal.
 */
function sanitizeComponent(value = '') {
  return value
    .replace(/[/\\]+/g, '-')     // path separators → hyphen
    .replace(/\.+/g, '-')        // dots → hyphen (prevent .. traversal)
    .replace(/[^\w-]+/g, '-')    // everything else → hyphen
    .replace(/^-+|-+$/g, '')     // trim leading/trailing hyphens
    .toLowerCase();
}

/**
 * Sanitize a multi-segment path (e.g. "form-instances/{id}").
 * Splits on "/", sanitizes each segment, filters empties, rejoins.
 */
function sanitizePath(value = '') {
  return value
    .split('/')
    .map((s) => sanitizeComponent(s))
    .filter(Boolean)
    .join('/');
}

/**
 * Build a safe, collision-resistant object key for R2.
 *
 * @param {object} options
 * @param {string} options.category         — e.g. "users", "organizations"
 * @param {string} [options.organizationId] — org-scoped folder
 * @param {string} [options.subfolder]      — additional path segment(s)
 * @param {string} [options.originalFilename] — used only to preserve extension
 * @returns {string} e.g. "ararms/users/550e8400-e29b-41d4-a716-446655440000.jpg"
 */
function generateStorageKey(options = {}) {
  const config = getR2Config();
  const { category, organizationId, subfolder, originalFilename } = options;

  if (!category) {
    throw new Error('generateStorageKey: "category" is required');
  }

  // Sanitize every path component — subfolders may contain / separators
  const cleanCategory = sanitizeComponent(category);
  const cleanOrg = organizationId ? sanitizeComponent(organizationId) : null;
  const cleanSub = subfolder ? sanitizePath(subfolder) : null;

  // Preserve file extension, lowercase only
  let ext = '.bin';
  if (originalFilename) {
    const parsed = path.parse(originalFilename);
    if (parsed.ext) {
      ext = parsed.ext.toLowerCase();
    }
  }

  const uuid = crypto.randomUUID();
  const filename = `${uuid}${ext}`;

  const segments = [config.keyPrefix, cleanCategory];
  if (cleanOrg) segments.push(cleanOrg);
  if (cleanSub) segments.push(cleanSub);
  segments.push(filename);

  return segments.join('/');
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Construct the public URL for a given storage key.
 *
 * @param {string} storageKey — R2 object key
 * @returns {string} e.g. https://media.arascreen.ai/ararms/users/abc.jpg
 */
function getUrl(storageKey) {
  const config = getR2Config();
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  const key = (storageKey || '').replace(/^\/+/, '');
  return `${base}/${key}`;
}

/**
 * Extract the R2 storage key from a full public URL.
 *
 * @param {string} url — e.g. https://media.arascreen.ai/ararms/users/abc.jpg
 * @returns {string|null} storage key, or null if URL doesn't match
 */
function extractStorageKey(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const config = getR2Config();

  // If already looks like a plain key (no hostname), return as-is
  if (!url.startsWith('http') && !url.startsWith('//')) {
    return url.startsWith(config.keyPrefix) ? url : null;
  }

  // Strip protocol and host
  const publicHost = config.publicBaseUrl
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  let normalized = url.replace(/^https?:\/\//, '');

  if (normalized.startsWith(publicHost)) {
    return normalized.slice(publicHost.length).replace(/^\/+/, '') || null;
  }

  // Also try matching just the endpoint hostname for non-public URLs
  const endpointHost = config.endpoint
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  if (normalized.startsWith(endpointHost)) {
    // Endpoint URLs are path-style: host/bucket/key
    const afterHost = normalized.slice(endpointHost.length).replace(/^\/+/, '');
    const bucketPrefix = `${config.bucketName}/`;
    if (afterHost.startsWith(bucketPrefix)) {
      return afterHost.slice(bucketPrefix.length) || null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a multer memory buffer to R2.
 *
 * @param {object} file               — multer file { buffer, originalname, mimetype, size }
 * @param {object} options
 * @param {string} options.category          — top-level folder
 * @param {string} [options.organizationId]  — org-scoped subfolder
 * @param {string} [options.subfolder]       — additional path
 * @returns {Promise<object>} { url, secure_url, path, storageKey, public_id, mimetype, size }
 */
async function upload(file, options = {}) {
  const config = getR2Config();

  if (!config.configured) {
    throw new Error(
      `R2 is not fully configured. Missing: ${config.missingVars.join(', ')}`
    );
  }

  const client = getClient();
  const storageKey = generateStorageKey(options);

  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: storageKey,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
    CacheControl: config.cacheControl
  });

  await client.send(command);

  const publicUrl = getUrl(storageKey);

  // Return an object compatible with what controllers expect (Cloudinary-like shape)
  return {
    url: publicUrl,
    secure_url: publicUrl,
    path: publicUrl,
    storageKey,
    public_id: storageKey,
    mimetype: file.mimetype || 'application/octet-stream',
    size: file.size || 0
  };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete an object from R2 by storage key or full URL.
 *
 * @param {string} keyOrUrl — storage key or public URL
 * @returns {Promise<boolean>} true if deleted
 */
async function deleteAsset(keyOrUrl) {
  const storageKey = extractStorageKey(keyOrUrl);
  if (!storageKey) return false;

  const config = getR2Config();
  if (!config.configured) return false;

  try {
    const client = getClient();
    const command = new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: storageKey
    });
    await client.send(command);
    return true;
  } catch (_err) {
    return false;
  }
}

module.exports = {
  upload,
  delete: deleteAsset,
  extractStorageKey,
  getUrl,
  generateStorageKey
};
