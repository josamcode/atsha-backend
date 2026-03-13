const mongoose = require('mongoose');

const organizationRegistrationVerificationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  codeHash: {
    type: String,
    required: true,
    select: false
  },
  verificationTokenHash: {
    type: String,
    select: false
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  consumedAt: {
    type: Date,
    default: null
  },
  languagePreference: {
    type: String,
    enum: ['ar', 'en'],
    default: 'en'
  },
  lastSentAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

organizationRegistrationVerificationSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model(
  'OrganizationRegistrationVerification',
  organizationRegistrationVerificationSchema
);
