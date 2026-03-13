const mongoose = require('mongoose');
const { slugPattern, normalizeOrganizationPlan } = require('../utils/tenantConstants');

const pricingSchema = new mongoose.Schema({
  amount: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'SAR'
  }
}, { _id: false });

const subscriptionPlanSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Plan code is required'],
    unique: true,
    trim: true,
    lowercase: true,
    set: normalizeOrganizationPlan,
    validate: {
      validator: (value) => slugPattern.test(value),
      message: 'Plan code must use lowercase letters, numbers, and hyphens only'
    }
  },
  name: {
    en: {
      type: String,
      required: [true, 'English plan name is required'],
      trim: true
    },
    ar: {
      type: String,
      trim: true
    }
  },
  description: {
    en: {
      type: String,
      trim: true,
      default: ''
    },
    ar: {
      type: String,
      trim: true,
      default: ''
    }
  },
  market: {
    primaryRegion: {
      type: String,
      trim: true,
      default: 'MENA'
    },
    primaryCountry: {
      type: String,
      trim: true,
      default: 'SA'
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'SAR'
    }
  },
  pricing: {
    monthly: {
      type: pricingSchema,
      default: () => ({ amount: 0, currency: 'SAR' })
    },
    yearly: {
      type: pricingSchema,
      default: () => ({ amount: 0, currency: 'SAR' })
    }
  },
  features: {
    qrCode: {
      type: Boolean,
      default: false
    },
    attendanceManagement: {
      type: Boolean,
      default: false
    },
    leaveManagement: {
      type: Boolean,
      default: false
    },
    messaging: {
      type: Boolean,
      default: false
    }
  },
  limits: {
    formsPerMonth: {
      type: Number,
      default: null
    },
    templatesTotal: {
      type: Number,
      default: null
    },
    usersTotal: {
      type: Number,
      default: null
    },
    messagesPerMonth: {
      type: Number,
      default: null
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
