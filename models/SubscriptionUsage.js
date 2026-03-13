const mongoose = require('mongoose');

const subscriptionUsageSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  metric: {
    type: String,
    required: true,
    trim: true
  },
  periodKey: {
    type: String,
    required: true,
    trim: true
  },
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  used: {
    type: Number,
    default: 0
  },
  lastIncrementedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

subscriptionUsageSchema.index(
  { organizationId: 1, metric: 1, periodKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('SubscriptionUsage', subscriptionUsageSchema);
