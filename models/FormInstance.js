const mongoose = require('mongoose');

const formInstanceSchema = new mongoose.Schema({
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
    enum: ['kitchen', 'counter', 'cleaning', 'management', 'delivery', 'other'],
    required: true
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
formInstanceSchema.index({ templateId: 1, date: -1 });
formInstanceSchema.index({ filledBy: 1, date: -1 });
formInstanceSchema.index({ department: 1, date: -1 });
formInstanceSchema.index({ status: 1, date: -1 });

module.exports = mongoose.model('FormInstance', formInstanceSchema);

