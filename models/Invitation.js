const mongoose = require('mongoose');
const {
  USER_ROLE_VALUES,
  isValidDepartmentCode,
  normalizeDepartmentCode,
  normalizeRole
} = require('../utils/tenantConstants');

const invitationSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/, 'Please provide a valid email']
  },
  role: {
    type: String,
    enum: USER_ROLE_VALUES,
    default: 'employee',
    set: normalizeRole
  },
  department: {
    type: String,
    trim: true,
    lowercase: true,
    set: normalizeDepartmentCode,
    default: 'other',
    validate: {
      validator: (value) => !value || isValidDepartmentCode(value),
      message: 'Department code must use lowercase letters, numbers, hyphens, or underscores'
    }
  },
  departments: [{
    type: String,
    trim: true,
    lowercase: true,
    set: normalizeDepartmentCode,
    validate: {
      validator: (value) => !value || isValidDepartmentCode(value),
      message: 'Department code must use lowercase letters, numbers, hyphens, or underscores'
    }
  }],
  languagePreference: {
    type: String,
    enum: ['ar', 'en'],
    default: 'en'
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'cancelled', 'expired'],
    default: 'pending',
    index: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  acceptedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  acceptedAt: {
    type: Date
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

invitationSchema.index(
  { organizationId: 1, email: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'pending'
    }
  }
);

invitationSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
invitationSchema.index({ organizationId: 1, expiresAt: 1 });

invitationSchema.pre('save', function (next) {
  if (this.role === 'supervisor' && (!this.departments || this.departments.length === 0)) {
    if (this.department && this.department !== 'other') {
      this.departments = [this.department];
    }
  }

  next();
});

module.exports = mongoose.model('Invitation', invitationSchema);
