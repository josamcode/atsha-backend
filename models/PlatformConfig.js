const mongoose = require('mongoose');
const { slugPattern, normalizeOrganizationPlan } = require('../utils/tenantConstants');
const { DEFAULT_PLATFORM_PROFILE } = require('../utils/platformDefaults');

const platformConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    unique: true,
    default: 'global',
    trim: true
  },
  profile: {
    platformName: {
      type: String,
      trim: true,
      default: DEFAULT_PLATFORM_PROFILE.platformName
    },
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: DEFAULT_PLATFORM_PROFILE.supportEmail
    },
    websiteUrl: {
      type: String,
      trim: true,
      default: DEFAULT_PLATFORM_PROFILE.websiteUrl
    },
    locale: {
      type: String,
      trim: true,
      default: DEFAULT_PLATFORM_PROFILE.locale
    },
    timezone: {
      type: String,
      trim: true,
      default: DEFAULT_PLATFORM_PROFILE.timezone
    },
    defaultOrganizationPlan: {
      type: String,
      trim: true,
      lowercase: true,
      default: DEFAULT_PLATFORM_PROFILE.defaultOrganizationPlan,
      set: normalizeOrganizationPlan,
      validate: {
        validator: (value) => !value || slugPattern.test(value),
        message: 'Default organization plan must use lowercase letters, numbers, and hyphens only'
      }
    },
    allowOrganizationRegistration: {
      type: Boolean,
      default: DEFAULT_PLATFORM_PROFILE.allowOrganizationRegistration
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PlatformConfig', platformConfigSchema);
