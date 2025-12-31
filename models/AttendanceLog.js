const mongoose = require('mongoose');

const attendanceLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['checkin', 'checkout'],
    required: true
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  method: {
    type: String,
    enum: ['qr', 'manual', 'biometric'],
    default: 'qr'
  },
  tokenId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AttendanceToken'
  },
  location: {
    type: String
  },
  notes: {
    type: String
  },
  metadata: {
    ip: String,
    device: String,
    userAgent: String,
    qrSequence: Number
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
attendanceLogSchema.index({ userId: 1, timestamp: -1 });
attendanceLogSchema.index({ timestamp: -1 });
attendanceLogSchema.index({ type: 1, timestamp: -1 });

module.exports = mongoose.model('AttendanceLog', attendanceLogSchema);

