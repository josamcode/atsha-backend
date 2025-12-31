const mongoose = require('mongoose');
const crypto = require('crypto');

const attendanceTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  validFrom: {
    type: Date,
    required: true,
    default: Date.now
  },
  validTo: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'used'],
    default: 'active',
    index: true
  },
  sequenceNumber: {
    type: Number,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  usageCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
attendanceTokenSchema.index({ status: 1, validTo: -1 });
attendanceTokenSchema.index({ createdAt: -1 });
attendanceTokenSchema.index({ sequenceNumber: -1 });

// Static method to generate unique token
attendanceTokenSchema.statics.generateToken = function () {
  return crypto.randomBytes(32).toString('hex');
};

// Static method to get next sequence number
attendanceTokenSchema.statics.getNextSequence = async function () {
  const lastToken = await this.findOne({ sequenceNumber: { $exists: true, $type: 'number' } })
    .sort({ sequenceNumber: -1 })
    .select('sequenceNumber');

  // Ensure we have a valid number
  if (lastToken && typeof lastToken.sequenceNumber === 'number' && !isNaN(lastToken.sequenceNumber)) {
    return lastToken.sequenceNumber + 1;
  }

  // Default to 1 if no valid sequence number found
  return 1;
};

// Method to check if token is valid
attendanceTokenSchema.methods.isValid = function () {
  const now = new Date();
  return (
    this.status === 'active' &&
    this.validFrom <= now &&
    this.validTo > now
  );
};

// Method to mark as used
attendanceTokenSchema.methods.markAsUsed = async function () {
  this.usageCount += 1;
  await this.save();
};

// Method to expire token
attendanceTokenSchema.methods.expire = async function () {
  this.status = 'expired';
  await this.save();
};

module.exports = mongoose.model('AttendanceToken', attendanceTokenSchema);

