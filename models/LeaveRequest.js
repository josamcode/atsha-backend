const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['vacation', 'sick', 'permission', 'emergency', 'unpaid', 'other'],
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalDate: {
    type: Date
  },
  approvalNotes: {
    type: String
  },
  days: {
    type: Number,
    required: true
  },
  attachments: [{
    filename: String,
    path: String,
    mimetype: String
  }]
}, {
  timestamps: true
});

// Calculate number of days before saving (only if days is not already set)
leaveRequestSchema.pre('save', function (next) {
  // Only calculate if days is not set or is 0
  if (this.startDate && this.endDate && (!this.days || this.days === 0)) {
    const diffTime = Math.abs(this.endDate - this.startDate);

    // For permission type, calculate days based on hours (8 hours = 1 day)
    if (this.type === 'permission') {
      const hours = diffTime / (1000 * 60 * 60);
      this.days = hours / 8; // Convert hours to days (assuming 8 hours work day)
    } else {
      // For other types, calculate full days
      this.days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
  }
  next();
});

// Indexes
leaveRequestSchema.index({ userId: 1, startDate: -1 });
leaveRequestSchema.index({ status: 1, startDate: -1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);

