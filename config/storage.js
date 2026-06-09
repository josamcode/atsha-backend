/**
 * Storage configuration — Cloudinary and Cloudflare R2
 *
 * Reads MEDIA_PROVIDER env to select the active storage backend.
 * Validates R2 credentials only when MEDIA_PROVIDER is "r2".
 * Never logs secret values.
 */

const MEDIA_PROVIDER = (process.env.MEDIA_PROVIDER || 'cloudinary').toLowerCase();

const VALID_PROVIDERS = new Set(['cloudinary', 'r2']);

/**
 * Return the active storage provider name.
 */
function getActiveProvider() {
  if (!VALID_PROVIDERS.has(MEDIA_PROVIDER)) {
    throw new Error(
      `Invalid MEDIA_PROVIDER "${MEDIA_PROVIDER}". Must be one of: ${[...VALID_PROVIDERS].join(', ')}`
    );
  }

  return MEDIA_PROVIDER;
}

/**
 * Cloudinary configuration (always available for backward compat with old assets).
 */
function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  const configured = Boolean(cloudName && apiKey && apiSecret);

  return {
    cloudName: cloudName || '',
    apiKey: apiKey || '',
    apiSecret: apiSecret || '',
    configured,
    uploadFolder: process.env.CLOUDINARY_FOLDER || 'AraRM'
  };
}

/**
 * R2 configuration — validated only when the active provider is "r2".
 */
function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || 'josam';
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const endpoint = process.env.R2_ENDPOINT || '';
  const region = process.env.R2_REGION || 'auto';
  const keyPrefix = (process.env.R2_KEY_PREFIX || 'ararms').replace(/^\/+|\/+$/g, '');
  const cacheControl = process.env.R2_CACHE_CONTROL || 'public, max-age=31536000, immutable';

  const missing = [];

  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!publicBaseUrl) missing.push('R2_PUBLIC_BASE_URL');
  if (!endpoint) missing.push('R2_ENDPOINT');

  const configured = missing.length === 0;

  return {
    accountId: accountId || '',
    accessKeyId: accessKeyId || '',
    secretAccessKey: secretAccessKey || '',
    bucketName,
    publicBaseUrl,
    endpoint,
    region,
    keyPrefix,
    cacheControl,
    configured,
    missingVars: missing
  };
}

/**
 * Validate that required R2 configuration is present.
 * Throws if MEDIA_PROVIDER is "r2" and any required env var is missing.
 */
function validateR2Config() {
  const r2Config = getR2Config();

  if (!r2Config.configured) {
    throw new Error(
      `R2 storage is not fully configured. Missing: ${r2Config.missingVars.join(', ')}`
    );
  }

  return r2Config;
}

/**
 * Get the full storage configuration for the active provider.
 */
function getStorageConfig() {
  const provider = getActiveProvider();
  const cloudinary = getCloudinaryConfig();
  const r2 = provider === 'r2' ? validateR2Config() : getR2Config();

  return { provider, cloudinary, r2 };
}

module.exports = {
  getActiveProvider,
  getCloudinaryConfig,
  getR2Config,
  getStorageConfig,
  validateR2Config
};
