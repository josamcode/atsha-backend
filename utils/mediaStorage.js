/**
 * Media storage orchestrator
 *
 * Routes uploads to the active provider (Cloudinary or Cloudflare R2)
 * and routes deletes by inspecting the stored URL domain.
 *
 * Uploads:    controlled by MEDIA_PROVIDER env ("cloudinary" | "r2")
 * Deletes:    dispatched by URL pattern:
 *               /uploads/*          → local filesystem delete
 *               res.cloudinary.com  → Cloudinary provider
 *               media.arascreen.ai  → R2 provider
 *
 * Backward-compatible — all existing controller code works unchanged.
 */

const fs = require('fs');
const path = require('path');
const { getActiveProvider } = require('../config/storage');

const cloudinaryProvider = require('../providers/cloudinary');
const r2Provider = require('../providers/r2');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a stored path is a Cloudinary URL.
 */
function isCloudinaryUrl(storedPath) {
  return Boolean(
    storedPath &&
    typeof storedPath === 'string' &&
    storedPath.includes('res.cloudinary.com')
  );
}

/**
 * Determine whether a stored path is an R2 URL.
 */
function isR2Url(storedPath) {
  if (!storedPath || typeof storedPath !== 'string') return false;

  // Match the configured R2 public base URL
  const baseUrl = (process.env.R2_PUBLIC_BASE_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  if (baseUrl && storedPath.includes(baseUrl)) return true;

  // Also match the R2 endpoint hostname (for raw endpoint URLs)
  const endpoint = (process.env.R2_ENDPOINT || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  if (endpoint && storedPath.includes(endpoint)) return true;

  return false;
}

/**
 * Determine whether a string looks like a raw R2 storage key
 * (starts with the configured R2_KEY_PREFIX, e.g. "ararms/...").
 */
function isR2StorageKey(value) {
  if (!value || typeof value !== 'string') return false;
  const prefix = (process.env.R2_KEY_PREFIX || 'ararms').replace(/^\/+|\/+$/g, '');
  return value.startsWith(`${prefix}/`) || value === prefix;
}

/**
 * Resolve the best deletion target from various input shapes.
 *
 *   - null / undefined / ''  →  ''             (safe no-op)
 *   - string                 →  pass-through   (URL, path, or raw storageKey)
 *   - object { storageKey }  →  storageKey     (exact R2 delete)
 *   - object { url, path }   →  url || path    (backward compat)
 *
 * @param {string|object|null|undefined} input
 * @returns {string}
 */
function resolveDeletionTarget(input) {
  if (!input) return '';

  // Plain string — pass through unchanged
  if (typeof input === 'string') return input;

  // Object (image record, field value, etc.)
  if (typeof input === 'object') {
    // Prefer storageKey for exact provider deletes
    if (input.storageKey) return input.storageKey;
    // Fallback to URL/path for backward compat
    return input.url || input.path || '';
  }

  return '';
}

// ---------------------------------------------------------------------------
// Local uploads
// ---------------------------------------------------------------------------

/**
 * Delete a file from the local uploads directory.
 *
 * @param {string} storedPath — path starting with /uploads/
 * @returns {Promise<boolean>}
 */
async function deleteLocalUpload(storedPath) {
  if (!storedPath || typeof storedPath !== 'string' || !storedPath.startsWith('/uploads/')) {
    return false;
  }

  const filePath = path.join(
    process.env.UPLOAD_DIR || './uploads',
    path.basename(storedPath)
  );

  if (!fs.existsSync(filePath)) {
    return false;
  }

  await fs.promises.unlink(filePath);
  return true;
}

// ---------------------------------------------------------------------------
// Delete — route by URL domain
// ---------------------------------------------------------------------------

/**
 * Delete a stored asset, dispatching to the correct provider.
 *
 * Accepts both legacy string inputs (URL, path) and object inputs
 * (image records with storageKey/url/path fields).
 *
 * Dispatch order:
 *   1. /uploads/*              → local filesystem
 *   2. res.cloudinary.com/*    → Cloudinary
 *   3. media.arascreen.ai/*    → R2
 *   4. Raw R2 storageKey       → R2 (exact key, no URL parsing)
 *   5. Fallback: try Cloudinary, then R2
 *
 * @param {string|object} storedPath — URL string, path, or image record object
 * @returns {Promise<boolean>}
 */
async function deleteStoredAsset(storedPath) {
  // Resolve object records → best deletion string
  const resolvedPath = resolveDeletionTarget(storedPath);

  if (!resolvedPath) {
    return false;
  }

  // 1. Local uploads
  if (resolvedPath.startsWith('/uploads/')) {
    return deleteLocalUpload(resolvedPath);
  }

  // 2. Cloudinary URL
  if (isCloudinaryUrl(resolvedPath)) {
    return cloudinaryProvider.delete(resolvedPath);
  }

  // 3. R2 URL
  if (isR2Url(resolvedPath)) {
    return r2Provider.delete(resolvedPath);
  }

  // 4. Raw R2 storageKey (e.g. "ararms/users/abc.jpg") — direct dispatch
  if (isR2StorageKey(resolvedPath)) {
    return r2Provider.delete(resolvedPath);
  }

  // 5. Ambiguous — try Cloudinary first (backward compat), then R2
  const deletedByCloudinary = await cloudinaryProvider.delete(resolvedPath);
  if (deletedByCloudinary) return true;

  const deletedByR2 = await r2Provider.delete(resolvedPath);
  return deletedByR2;
}

// ---------------------------------------------------------------------------
// Upload — dispatch by MEDIA_PROVIDER
// ---------------------------------------------------------------------------

/**
 * Return the provider module for new uploads.
 */
function getUploadProvider() {
  const active = getActiveProvider();
  return active === 'r2' ? r2Provider : cloudinaryProvider;
}

/**
 * Upload a user profile image.
 *
 * @param {object} file — multer file object
 * @returns {Promise<object>} { url, secure_url, path, storageKey, ... }
 */
async function uploadUserImage(file) {
  const provider = getUploadProvider();

  if (provider === r2Provider) {
    return r2Provider.upload(file, { category: 'users' });
  }

  // Cloudinary path — keep existing folder convention
  const { getCloudinaryConfig } = require('../config/storage');
  const uploadFolder = getCloudinaryConfig().uploadFolder;
  return cloudinaryProvider.upload(file, { folder: `${uploadFolder}/users` });
}

/**
 * Upload a form instance image.
 *
 * @param {object} file               — multer file object
 * @param {string} organizationId     — owning organization
 * @param {string} [formInstanceId]   — form instance (optional)
 * @returns {Promise<object>}
 */
async function uploadFormImage(file, organizationId, formInstanceId) {
  const provider = getUploadProvider();

  if (provider === r2Provider) {
    const resolvedOrgId = formInstanceId ? organizationId : null;
    const resolvedInstanceId = formInstanceId || organizationId;
    const subfolder = resolvedOrgId
      ? `form-instances/${resolvedInstanceId}`
      : `form-instances/${resolvedInstanceId}`;

    return r2Provider.upload(file, {
      category: 'organizations',
      organizationId: resolvedOrgId || undefined,
      subfolder
    });
  }

  // Cloudinary folder path — keep existing logic
  const { getCloudinaryConfig } = require('../config/storage');
  const uploadFolder = getCloudinaryConfig().uploadFolder;

  const resolvedOrganizationId = formInstanceId ? organizationId : null;
  const resolvedFormInstanceId = formInstanceId || organizationId;
  const folder = resolvedOrganizationId
    ? `${uploadFolder}/organizations/${resolvedOrganizationId}/form-instances/${resolvedFormInstanceId}`
    : `${uploadFolder}/form-instances/${resolvedFormInstanceId}`;

  return cloudinaryProvider.upload(file, { folder });
}

/**
 * Upload an organization branding asset (logo / watermark).
 *
 * @param {object} file             — multer file object
 * @param {string} organizationId
 * @param {string} assetType        — e.g. "logo", "watermark"
 * @returns {Promise<object>}
 */
async function uploadOrganizationBrandingAsset(file, organizationId, assetType) {
  const provider = getUploadProvider();

  if (provider === r2Provider) {
    return r2Provider.upload(file, {
      category: 'organizations',
      organizationId,
      subfolder: `branding/${assetType}`
    });
  }

  // Cloudinary folder path
  const { getCloudinaryConfig } = require('../config/storage');
  const uploadFolder = getCloudinaryConfig().uploadFolder;
  const folder = `${uploadFolder}/organizations/${organizationId}/branding/${assetType}`;

  return cloudinaryProvider.upload(file, { folder });
}

module.exports = {
  deleteStoredAsset,
  deleteLocalUpload,
  resolveDeletionTarget,
  uploadFormImage,
  uploadOrganizationBrandingAsset,
  uploadUserImage
};
