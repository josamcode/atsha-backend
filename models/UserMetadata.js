const mongoose = require('mongoose');

/**
 * UserMetadata - Stores large metadata and extended user data
 * Separated from User collection to keep user documents lightweight
 */
const userMetadataSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
    // Index will be created explicitly below
  },
  // Large metadata map moved here
  metadata: {
    type: Map,
    of: String,
    default: new Map()
  },
  // Extended work schedule data if it becomes large
  extendedWorkSchedule: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Any other large fields that might be added in the future
  customFields: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Store image as URL/path reference (not base64)
  imageUrl: {
    type: String,
    trim: true
  },
  // Activity tracking metadata
  lastActivityAt: {
    type: Date
  },
  preferences: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
// Note: userId already has unique: true which creates an index, so we only add the compound/other indexes
userMetadataSchema.index({ lastActivityAt: -1 });

module.exports = mongoose.model('UserMetadata', userMetadataSchema);

