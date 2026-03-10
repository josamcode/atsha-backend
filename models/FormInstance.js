const mongoose = require('mongoose');
const { isValidDepartmentCode, normalizeDepartmentCode } = require('../utils/tenantConstants');

const formInstanceSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FormTemplate',
    required: true
  },
  filledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  department: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    set: normalizeDepartmentCode,
    validate: {
      validator: (value) => isValidDepartmentCode(value),
      message: 'Department code must use lowercase letters, numbers, hyphens, or underscores'
    }
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  shift: {
    type: String,
    enum: ['morning', 'evening', 'night'],
    default: 'morning'
  },
  values: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected'],
    default: 'draft'
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
  attachments: [{
    filename: String,
    path: String,
    mimetype: String,
    size: Number,
    uploadedAt: Date
  }],
  // Form images (uploaded by admin when viewing/filling the form)
  images: [{
    filename: String,
    url: String,
    path: String,
    mimetype: String,
    size: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Indexes for efficient queries
formInstanceSchema.index({ organizationId: 1, templateId: 1, date: -1 });
formInstanceSchema.index({ organizationId: 1, filledBy: 1, date: -1 });
formInstanceSchema.index({ organizationId: 1, department: 1, date: -1 });
formInstanceSchema.index({ organizationId: 1, status: 1, date: -1 });

module.exports = mongoose.model('FormInstance', formInstanceSchema);

