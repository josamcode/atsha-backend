const mongoose = require('mongoose');

/**
 * UserActivityLog - Stores user activity logs separately
 * Prevents user documents from growing unbounded
 */
const userActivityLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'login',
      'logout',
      'profile_update',
      'password_change',
      'form_submit',
      'form_view',
      'attendance_checkin',
      'attendance_checkout',
      'leave_request',
      'message_sent',
      'message_read',
      'notification_read',
      'settings_change',
      'other'
    ]
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  device: {
    type: String
  },
  location: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
userActivityLogSchema.index({ userId: 1, createdAt: -1 });
userActivityLogSchema.index({ action: 1, createdAt: -1 });
userActivityLogSchema.index({ createdAt: -1 });

// Compound index for user activity queries
userActivityLogSchema.index({ userId: 1, action: 1, createdAt: -1 });

// TTL index - automatically delete logs older than 1 year (optional)
// userActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000 });

module.exports = mongoose.model('UserActivityLog', userActivityLogSchema);

