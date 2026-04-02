const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true,
    maxlength: 160
  },
  details: {
    type: String,
    required: [true, 'Task details are required'],
    trim: true,
    maxlength: 5000
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  dueDate: {
    type: Date,
    default: null,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'completed'],
    default: 'pending',
    index: true
  },
  isOverdue: {
    type: Boolean,
    default: false,
    index: true
  },
  responseNotes: {
    type: String,
    trim: true,
    default: ''
  },
  respondedAt: {
    type: Date,
    default: null
  },
  completionNotes: {
    type: String,
    trim: true,
    default: ''
  },
  completedAt: {
    type: Date,
    default: null
  },
  overdueNotifiedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

taskSchema.index({ organizationId: 1, assignedTo: 1, status: 1, createdAt: -1 });
taskSchema.index({ organizationId: 1, assignedBy: 1, status: 1, createdAt: -1 });
taskSchema.index({ organizationId: 1, isOverdue: 1, dueDate: 1, status: 1 });

module.exports = mongoose.model('Task', taskSchema);
