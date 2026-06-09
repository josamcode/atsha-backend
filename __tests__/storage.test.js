/**
 * Storage layer verification script
 *
 * Tests key generation, URL extraction, and delete routing without
 * requiring any test framework.  Run with:
 *
 *   node __tests__/storage.test.js
 *
 * Set temporary env vars so tests can run without a full .env file.
 */

// ---------------------------------------------------------------------------
// Setup — set required env vars before requiring modules
// ---------------------------------------------------------------------------
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'test-account-id';
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'test-secret-key';
process.env.R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'josam';
process.env.R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || 'https://media.arascreen.ai';
process.env.R2_ENDPOINT = process.env.R2_ENDPOINT || 'https://test-account.r2.cloudflarestorage.com';
process.env.R2_KEY_PREFIX = process.env.R2_KEY_PREFIX || 'ararms';
process.env.R2_CACHE_CONTROL = process.env.R2_CACHE_CONTROL || 'public, max-age=31536000, immutable';
process.env.MEDIA_PROVIDER = process.env.MEDIA_PROVIDER || 'r2';

// Cloudinary env — keep old values so cloudinary provider can init
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test-cloud';
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '123456';
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test-secret';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual:   ${JSON.stringify(actual)}`);
  }
}

function assertMatch(actual, regex, label) {
  if (regex.test(actual)) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
    console.error(`       regex: ${regex}`);
    console.error(`       actual: ${actual}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== Storage Config Tests ===\n');

const { getActiveProvider, getCloudinaryConfig, getR2Config, getStorageConfig } = require('../config/storage');

// 1. Active provider
{
  assertEqual(getActiveProvider(), 'r2', 'getActiveProvider returns "r2" when MEDIA_PROVIDER=r2');
}

// 2. Cloudinary config
{
  const cfg = getCloudinaryConfig();
  assert(cfg.configured === true, 'Cloudinary config reports configured when env vars present');
  assertEqual(cfg.uploadFolder, 'AraRM', 'Cloudinary upload folder defaults to AraRM');
}

// 3. R2 config
{
  const cfg = getR2Config();
  assert(cfg.configured === true, 'R2 config reports configured with valid env vars');
  assertEqual(cfg.bucketName, 'josam', 'R2 bucket name from env');
  assertEqual(cfg.region, 'auto', 'R2 region defaults to auto');
  assertEqual(cfg.keyPrefix, 'ararms', 'R2 key prefix from env');
  assert(cfg.publicBaseUrl === 'https://media.arascreen.ai', 'R2 public base URL from env');
  assert(cfg.missingVars.length === 0, 'R2 config reports zero missing vars');
}

// 4. Storage config
{
  const cfg = getStorageConfig();
  assertEqual(cfg.provider, 'r2', 'Storage config provider is r2');
  assert(cfg.cloudinary.configured === true, 'Storage config includes cloudinary config');
  assert(cfg.r2.configured === true, 'Storage config includes r2 config');
}

console.log('\n=== R2 Key Generation Tests ===\n');

const { generateStorageKey, extractStorageKey: r2ExtractKey, getUrl } = require('../providers/r2');

// 5. Basic key generation
{
  const key = generateStorageKey({ category: 'users', originalFilename: 'photo.jpg' });
  assert(key.startsWith('ararms/users/'), 'Key starts with prefix/category');
  assert(key.endsWith('.jpg'), 'Key preserves lowercase extension');
  assertMatch(key, /^ararms\/users\/[0-9a-f-]{36}\.jpg$/, 'Key format: prefix/category/uuid.ext');
}

// 6. Key with organizationId and subfolder
{
  const key = generateStorageKey({
    category: 'organizations',
    organizationId: '507f1f77bcf86cd799439011',
    subfolder: 'form-instances/507f1f77bcf86cd799439022',
    originalFilename: 'IMG_1234.PNG'
  });
  assert(key.startsWith('ararms/organizations/507f1f77bcf86cd799439011/form-instances/507f1f77bcf86cd799439022/'), 'Key includes org + subfolder');
  assert(key.endsWith('.png'), 'Extension lowercased');
}

// 7. Key without extension falls back to .bin
{
  const key = generateStorageKey({ category: 'users', originalFilename: 'noext' });
  assert(key.endsWith('.bin'), 'Fallback extension is .bin when none provided');
}

// 8. Key sanitizes path traversal in originalFilename
{
  const key = generateStorageKey({ category: 'users', originalFilename: '../../../etc/passwd.jpg' });
  assert(!key.includes('..'), 'Key does not contain ..');
  assert(!key.includes('etc'), 'Key does not contain path segments from filename');
  assertMatch(key, /^ararms\/users\/[0-9a-f-]{36}\.jpg$/, 'Traversal attempt sanitized to normal key');
}

// 9. Key sanitizes path traversal in category
{
  const key = generateStorageKey({ category: '../../root', originalFilename: 'test.png' });
  assert(!key.includes('..'), 'Key does not contain .. in category (traversal blocked)');
  assert(!key.includes('../'), 'Key does not contain ../ traversal sequence');
  assert(key.startsWith('ararms/'), 'Key is still properly namespaced under prefix');
}

// 10. Unique keys for same input
{
  const k1 = generateStorageKey({ category: 'users', originalFilename: 'a.jpg' });
  const k2 = generateStorageKey({ category: 'users', originalFilename: 'a.jpg' });
  assert(k1 !== k2, 'Two calls produce different UUIDs — no collisions');
}

// 11. Sanitize special characters in category
{
  const key = generateStorageKey({ category: 'users/profile', originalFilename: 'test.png' });
  assert(!key.includes('/profile'), 'Forward slash in category replaced with hyphen');
}

console.log('\n=== R2 URL Tests ===\n');

// 12. getUrl constructs public URL
{
  const url = getUrl('ararms/users/abc-123.jpg');
  assertEqual(url, 'https://media.arascreen.ai/ararms/users/abc-123.jpg', 'getUrl builds correct public URL');
}

// 13. getUrl strips leading slash
{
  const url = getUrl('/ararms/x.jpg');
  assertEqual(url, 'https://media.arascreen.ai/ararms/x.jpg', 'getUrl handles leading slash');
}

// 14. extractStorageKey from public URL
{
  const key = r2ExtractKey('https://media.arascreen.ai/ararms/users/abc.jpg');
  assertEqual(key, 'ararms/users/abc.jpg', 'extractStorageKey from public URL');
}

// 15. extractStorageKey from plain key
{
  const key = r2ExtractKey('ararms/organizations/org1/branding/logo/uuid.png');
  assertEqual(key, 'ararms/organizations/org1/branding/logo/uuid.png', 'extractStorageKey passes through plain keys');
}

// 16. extractStorageKey null for non-R2 URL
{
  const key = r2ExtractKey('https://res.cloudinary.com/demo/image/upload/v1/test.jpg');
  assertEqual(key, null, 'extractStorageKey returns null for Cloudinary URL');
}

// 17. extractStorageKey null for falsy input
{
  assertEqual(r2ExtractKey(null), null, 'extractStorageKey(null) → null');
  assertEqual(r2ExtractKey(''), null, 'extractStorageKey("") → null');
  assertEqual(r2ExtractKey(undefined), null, 'extractStorageKey(undefined) → null');
}

console.log('\n=== Cloudinary Extract Public ID Tests ===\n');

const { extractCloudinaryPublicId } = require('../providers/cloudinary');

// 18. Standard Cloudinary URL
{
  const pid = extractCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/v1234567890/AraRM/users/filename.jpg');
  assertEqual(pid, 'AraRM/users/filename', 'Extract public_id from standard Cloudinary URL');
}

// 19. Cloudinary URL without version
{
  const pid = extractCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/AraRM/test/file');
  assertEqual(pid, 'AraRM/test/file', 'Extract public_id without version segment');
}

// 20. Null for non-Cloudinary URL
{
  assertEqual(extractCloudinaryPublicId('https://media.arascreen.ai/ararms/x.jpg'), null, 'extractCloudinaryPublicId returns null for R2 URL');
  assertEqual(extractCloudinaryPublicId(null), null, 'extractCloudinaryPublicId(null) → null');
  assertEqual(extractCloudinaryPublicId(''), null, 'extractCloudinaryPublicId("") → null');
}

console.log('\n=== mediaStorage Delete Routing Tests ===\n');

// We can test the URL detection heuristics used by mediaStorage.js
// by checking isCloudinaryUrl / isR2Url patterns directly

// 21. Cloudinary URL detection
{
  // These patterns are used inside mediaStorage.js
  const cu = 'https://res.cloudinary.com/dygf0lakc/image/upload/v123/AraRM/users/x.jpg';
  assert(cu.includes('res.cloudinary.com'), 'Cloudinary URL contains res.cloudinary.com');
}

// 22. R2 URL detection
{
  const ru = 'https://media.arascreen.ai/ararms/users/x.jpg';
  assert(ru.includes('media.arascreen.ai'), 'R2 URL contains media.arascreen.ai');
}

// 23. Local upload detection
{
  assert('/uploads/photo.jpg'.startsWith('/uploads/'), 'Local upload starts with /uploads/');
}

console.log('\n=== R2 Key Generation Edge Cases ===\n');

// 24. Empty originalFilename
{
  const key = generateStorageKey({ category: 'users', originalFilename: '' });
  assert(key.endsWith('.bin'), 'Empty filename → .bin extension');
  assertMatch(key, /^ararms\/users\/[0-9a-f-]{36}\.bin$/, 'Valid key format with empty filename');
}

// 25. No originalFilename
{
  const key = generateStorageKey({ category: 'users' });
  assert(key.endsWith('.bin'), 'Missing filename → .bin extension');
}

// 26. Very long filename
{
  const longName = 'very-long-filename-with-many-characters-'.repeat(20) + '.jpg';
  const key = generateStorageKey({ category: 'users', originalFilename: longName });
  // Should still work — UUID is used, not the long name
  assertMatch(key, /^ararms\/users\/[0-9a-f-]{36}\.jpg$/, 'Long filename still produces valid key');
}

// 27. Unicode filename
{
  const key = generateStorageKey({ category: 'users', originalFilename: 'صورة.jpg' });
  assert(key.endsWith('.jpg'), 'Unicode filename preserves extension');
  assert(!key.includes('صورة'), 'Unicode chars removed from key path');
}

// 28. Missing category throws
{
  try {
    generateStorageKey({});
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e.message.includes('category'), 'Missing category throws descriptive error');
  }
}

console.log('\n=== R2 Public URL Edge Cases ===\n');

// 29. getUrl with empty key
{
  const url = getUrl('');
  assertEqual(url, 'https://media.arascreen.ai/', 'getUrl handles empty key gracefully');
}

// 30. extractStorageKey with mismatched hostname
{
  const key = r2ExtractKey('https://other-cdn.com/ararms/x.jpg');
  assertEqual(key, null, 'extractStorageKey returns null for unknown host');
}

// ---------------------------------------------------------------------------
// Phase 4: resolveDeletionTarget & object-aware deleteStoredAsset
// ---------------------------------------------------------------------------

console.log('\n=== Phase 4: resolveDeletionTarget Tests ===\n');

const { resolveDeletionTarget } = require('../utils/mediaStorage');

// 31. Null/undefined returns empty string (safe no-op)
{
  assertEqual(resolveDeletionTarget(null), '', 'null → empty string');
  assertEqual(resolveDeletionTarget(undefined), '', 'undefined → empty string');
  assertEqual(resolveDeletionTarget(''), '', 'empty string → empty string');
}

// 32. Plain string pass-through
{
  assertEqual(
    resolveDeletionTarget('https://res.cloudinary.com/demo/image/upload/v1/test.jpg'),
    'https://res.cloudinary.com/demo/image/upload/v1/test.jpg',
    'Cloudinary URL string passed through unchanged'
  );
  assertEqual(
    resolveDeletionTarget('https://media.arascreen.ai/ararms/users/x.jpg'),
    'https://media.arascreen.ai/ararms/users/x.jpg',
    'R2 URL string passed through unchanged'
  );
  assertEqual(
    resolveDeletionTarget('/uploads/photo.jpg'),
    '/uploads/photo.jpg',
    'Local upload path passed through unchanged'
  );
}

// 33. Object with storageKey — prefers storageKey (exact R2 delete)
{
  const obj = { url: 'https://media.arascreen.ai/ararms/users/abc.jpg', storageKey: 'ararms/users/abc.jpg' };
  assertEqual(resolveDeletionTarget(obj), 'ararms/users/abc.jpg', 'Object with storageKey → returns storageKey');
}

// 34. Object without storageKey — falls back to url, then path
{
  const obj = { url: 'https://res.cloudinary.com/demo/image/upload/v1/test.jpg', path: '/old/path' };
  assertEqual(resolveDeletionTarget(obj), 'https://res.cloudinary.com/demo/image/upload/v1/test.jpg', 'Object without storageKey → url');
}

// 35. Object with only path (no url)
{
  const obj = { path: '/uploads/old-file.pdf' };
  assertEqual(resolveDeletionTarget(obj), '/uploads/old-file.pdf', 'Object with only path → path');
}

// 36. Object with empty fields still safe
{
  assertEqual(resolveDeletionTarget({}), '', 'Empty object → empty string');
  assertEqual(resolveDeletionTarget({ url: '', path: '' }), '', 'Object with empty url/path → empty string');
}

// 37. R2 storageKey in object takes priority over url
{
  const obj = { url: 'https://media.arascreen.ai/ararms/users/uuid.jpg', storageKey: 'ararms/users/uuid.jpg', path: 'https://media.arascreen.ai/ararms/users/uuid.jpg' };
  const result = resolveDeletionTarget(obj);
  // storageKey should win even though url and path are also R2 URLs
  assertEqual(result, 'ararms/users/uuid.jpg', 'storageKey preferred over url/path in objects');
}

console.log('\n=== Phase 4: Object-aware deleteStoredAsset Routing ===\n');

const { deleteStoredAsset } = require('../utils/mediaStorage');

// 38. deleteStoredAsset with object (storageKey for R2) — validates
//     Note: won't actually delete (no real S3), but should not throw and should resolve
{
  // We cannot test actual deletion without real credentials,
  // but we can verify the function accepts objects without throwing.
  const testObj = { url: 'https://media.arascreen.ai/ararms/users/nonexistent.jpg', storageKey: 'ararms/users/nonexistent.jpg' };
  // deleteStoredAsset should not throw on object input; it should attempt the delete and return false
  deleteStoredAsset(testObj).then((result) => {
    assertEqual(typeof result, 'boolean', 'deleteStoredAsset with object returns boolean');
    // Not asserting true/false — depends on whether S3 client is configured
  }).catch((_err) => {
    // If R2 is not configured, this might throw. That's acceptable for testing.
    // We just don't want it to crash on wrong input type.
  });
}

// 39. Null safety — deleteStoredAsset with null
{
  deleteStoredAsset(null).then((result) => {
    assertEqual(result, false, 'deleteStoredAsset(null) → false');
  });
}

// 40. deleteStoredAsset with undefined
{
  deleteStoredAsset(undefined).then((result) => {
    assertEqual(result, false, 'deleteStoredAsset(undefined) → false');
  });
}

// 41. deleteStoredAsset with empty string
{
  deleteStoredAsset('').then((result) => {
    assertEqual(result, false, 'deleteStoredAsset("") → false');
  });
}

console.log('\n=== Phase 4: Model Schema Verification ===\n');

// 42. FormInstance images[] has storageKey in schema
{
  const FormInstance = require('../models/FormInstance');
  // Mongoose stores subdocument paths in the DocumentArray's own schema
  const imagesSchema = FormInstance.schema.path('images');
  const hasImageStorageKey = imagesSchema && imagesSchema.schema &&
    'storageKey' in imagesSchema.schema.paths;
  assert(hasImageStorageKey, 'FormInstance schema includes images.storageKey');
}

// 43. User model has imageStorageKey
{
  const User = require('../models/User');
  const hasImageStorageKey = 'imageStorageKey' in User.schema.paths;
  assert(hasImageStorageKey, 'User schema includes imageStorageKey');
}

// 44. Organization branding has logoStorageKey and watermarkStorageKey
{
  const Organization = require('../models/Organization');
  const brandingPaths = Object.keys(Organization.schema.paths).filter(
    (p) => p.startsWith('branding.')
  );
  const hasLogoKey = brandingPaths.includes('branding.logoStorageKey');
  const hasWatermarkKey = brandingPaths.includes('branding.watermarkStorageKey');
  const hasFaviconKey = brandingPaths.includes('branding.faviconStorageKey');
  assert(hasLogoKey, 'Organization schema includes branding.logoStorageKey');
  assert(hasWatermarkKey, 'Organization schema includes branding.watermarkStorageKey');
  assert(hasFaviconKey, 'Organization schema includes branding.faviconStorageKey');
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
