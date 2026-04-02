const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'form_created',
      'form_submitted',
      'form_approved',
      'form_rejected',
      'user_absent',
      'user_late',
      'leave_requested',
      'leave_approved',
      'leave_rejected',
      'task_assigned',
      'task_accepted',
      'task_rejected',
      'task_completed',
      'task_overdue',
      'user_created',
      'user_updated',
      'attendance_checkin',
      'attendance_checkout',
      'system_alert'
    ],
    required: true
  },
  title: {
    en: { type: String, required: true },
    ar: { type: String, required: true }
  },
  message: {
    en: { type: String, required: true },
    ar: { type: String, required: true }
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
notificationSchema.index({ organizationId: 1, recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, recipient: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

