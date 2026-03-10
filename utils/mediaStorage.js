const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const { v2: cloudinary } = require('cloudinary');

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const uploadRootFolder = process.env.CLOUDINARY_FOLDER || 'atsha';

const sanitizeFilename = (filename = 'file') => {
  const parsed = path.parse(filename);
  const sanitized = parsed.name
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return sanitized || 'file';
};

const ensureCloudinaryConfigured = () => {
  if (!cloudinaryConfigured) {
    throw new Error('Cloudinary is not configured on the server.');
  }
};

const uploadBufferToCloudinary = (file, folder) => new Promise((resolve, reject) => {
  ensureCloudinaryConfigured();

  const uploadStream = cloudinary.uploader.upload_stream({
    folder,
    resource_type: 'auto',
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    filename_override: sanitizeFilename(file.originalname)
  }, (error, result) => {
    if (error) {
      return reject(error);
    }

    return resolve(result);
  });

  const bufferStream = new PassThrough();
  bufferStream.end(file.buffer);
  bufferStream.pipe(uploadStream);
});

const extractCloudinaryPublicId = (storedPath) => {
  if (!storedPath || typeof storedPath !== 'string' || !storedPath.includes('/upload/')) {
    return null;
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
};

const deleteFromCloudinary = async (storedPath) => {
  const publicId = extractCloudinaryPublicId(storedPath);

  if (!publicId) {
    return false;
  }

  ensureCloudinaryConfigured();

  const resourceTypes = ['image', 'raw', 'video'];

  for (const resourceType of resourceTypes) {
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: resourceType
    });

    if (result.result === 'ok') {
      return true;
    }
  }

  return false;
};

const deleteLocalUpload = async (storedPath) => {
  if (!storedPath || typeof storedPath !== 'string' || !storedPath.startsWith('/uploads/')) {
    return false;
  }

  const filePath = path.join(process.env.UPLOAD_DIR || './uploads', path.basename(storedPath));

  if (!fs.existsSync(filePath)) {
    return false;
  }

  await fs.promises.unlink(filePath);
  return true;
};

const deleteStoredAsset = async (storedPath) => {
  if (!storedPath) {
    return false;
  }

  if (storedPath.startsWith('/uploads/')) {
    return deleteLocalUpload(storedPath);
  }

  return deleteFromCloudinary(storedPath);
};

const uploadUserImage = (file) => uploadBufferToCloudinary(file, `${uploadRootFolder}/users`);

const uploadFormImage = (file, organizationId, formInstanceId) => {
  const resolvedOrganizationId = formInstanceId ? organizationId : null;
  const resolvedFormInstanceId = formInstanceId || organizationId;
  const folder = resolvedOrganizationId
    ? `${uploadRootFolder}/organizations/${resolvedOrganizationId}/form-instances/${resolvedFormInstanceId}`
    : `${uploadRootFolder}/form-instances/${resolvedFormInstanceId}`;

  return uploadBufferToCloudinary(file, folder);
};

module.exports = {
  deleteStoredAsset,
  uploadFormImage,
  uploadUserImage
};
