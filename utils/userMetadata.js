/**
 * User Metadata Utilities
 * Helper functions for managing user metadata in separate collection
 */

const UserMetadata = require('../models/UserMetadata');

/**
 * Get user metadata
 * @param {String|ObjectId} userId - User ID
 * @returns {Promise<Object|null>}
 */
async function getUserMetadata(userId) {
  return await UserMetadata.findOne({ userId }).lean();
}

/**
 * Set user metadata
 * @param {String|ObjectId} userId - User ID
 * @param {Object} metadata - Metadata object
 * @param {Object} options - Additional options
 * @returns {Promise<Object>}
 */
async function setUserMetadata(userId, metadata = {}, options = {}) {
  const { upsert = true, merge = true } = options;
  
  if (merge) {
    return await UserMetadata.findOneAndUpdate(
      { userId },
      { 
        $set: { 
          metadata: metadata.metadata || new Map(),
          extendedWorkSchedule: metadata.extendedWorkSchedule || {},
          customFields: metadata.customFields || {},
          ...(metadata.imageUrl && { imageUrl: metadata.imageUrl }),
          ...(metadata.preferences && { preferences: metadata.preferences }),
          lastActivityAt: new Date()
        }
      },
      { upsert, new: true }
    );
  } else {
    return await UserMetadata.findOneAndUpdate(
      { userId },
      metadata,
      { upsert, new: true }
    );
  }
}

/**
 * Update specific metadata field
 * @param {String|ObjectId} userId - User ID
 * @param {String} field - Field name
 * @param {*} value - Field value
 * @returns {Promise<Object>}
 */
async function updateMetadataField(userId, field, value) {
  const update = {};
  update[field] = value;
  update.lastActivityAt = new Date();
  
  return await UserMetadata.findOneAndUpdate(
    { userId },
    { $set: update },
    { upsert: true, new: true }
  );
}

/**
 * Delete user metadata
 * @param {String|ObjectId} userId - User ID
 * @returns {Promise<Boolean>}
 */
async function deleteUserMetadata(userId) {
  const result = await UserMetadata.deleteOne({ userId });
  return result.deletedCount > 0;
}

/**
 * Get metadata for multiple users
 * @param {Array<String|ObjectId>} userIds - Array of user IDs
 * @returns {Promise<Array>}
 */
async function getMultipleUserMetadata(userIds) {
  return await UserMetadata.find({ userId: { $in: userIds } }).lean();
}

module.exports = {
  getUserMetadata,
  setUserMetadata,
  updateMetadataField,
  deleteUserMetadata,
  getMultipleUserMetadata
};

