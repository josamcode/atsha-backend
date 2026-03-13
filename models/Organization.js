const mongoose = require('mongoose');
const {
  LEGACY_DEPARTMENTS,
  ORGANIZATION_STATUS_VALUES,
  isValidDepartmentCode,
  isValidSlug,
  normalizeDepartmentCode,
  normalizeDomain,
  normalizeOrganizationPlan,
  slugPattern
} = require('../utils/tenantConstants');

const titleizeDepartment = (value) => value
  .split(/[-_]/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const buildDefaultDepartments = () => LEGACY_DEPARTMENTS.map((code, index) => ({
  code,
  name: {
    en: titleizeDepartment(code),
    ar: titleizeDepartment(code)
  },
  isActive: true,
  sortOrder: index,
  isDefault: code === 'other'
}));

const departmentSchema = new mongoose.Schema({
  code: {
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
  name: {
    en: {
      type: String,
      required: true,
      trim: true
    },
    ar: {
      type: String,
      trim: true
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Organization name is required'],
    trim: true
  },
  slug: {
    type: String,
    required: [true, 'Organization slug is required'],
    trim: true,
    lowercase: true,
    unique: true,
    validate: {
      validator: isValidSlug,
      message: 'Organization slug must use lowercase letters, numbers, and hyphens only'
    }
  },
  status: {
    type: String,
    enum: ORGANIZATION_STATUS_VALUES,
    default: 'active',
    index: true
  },
  plan: {
    type: String,
    default: 'free',
    trim: true,
    lowercase: true,
    set: normalizeOrganizationPlan,
    validate: {
      validator: (value) => !value || slugPattern.test(value),
      message: 'Organization plan must use lowercase letters, numbers, and hyphens only'
    }
  },
  subscription: {
    planCode: {
      type: String,
      trim: true,
      lowercase: true
    },
    status: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'expired', 'cancelled', 'suspended'],
      default: 'active'
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'semiannual', 'annual', 'custom'],
      default: 'monthly'
    },
    startsAt: Date,
    endsAt: Date,
    graceEndsAt: Date,
    downgradePlanCode: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'free'
    },
    market: {
      primaryRegion: {
        type: String,
        default: 'MENA'
      },
      primaryCountry: {
        type: String,
        default: 'SA'
      },
      currency: {
        type: String,
        default: 'SAR'
      }
    },
    customLimits: {
      formsPerMonth: Number,
      templatesTotal: Number,
      usersTotal: Number,
      messagesPerMonth: Number
    },
    customFeatures: {
      qrCode: Boolean,
      attendanceManagement: Boolean,
      leaveManagement: Boolean,
      messaging: Boolean
    },
    notes: {
      type: String,
      trim: true
    }
  },
  branding: {
    displayName: {
      type: String,
      trim: true
    },
    shortName: {
      type: String,
      trim: true
    },
    legalName: {
      type: String,
      trim: true
    },
    logoUrl: {
      type: String,
      trim: true
    },
    watermarkUrl: {
      type: String,
      trim: true
    },
    faviconUrl: {
      type: String,
      trim: true
    },
    primaryColor: {
      type: String,
      default: '#d4b900'
    },
    secondaryColor: {
      type: String,
      default: '#b51c20'
    },
    supportEmail: {
      type: String,
      trim: true,
      lowercase: true
    },
    emailFromName: {
      type: String,
      trim: true
    },
    websiteUrl: {
      type: String,
      trim: true
    }
  },
  locale: {
    type: String,
    default: 'en',
    trim: true
  },
  timezone: {
    type: String,
    default: 'Africa/Cairo',
    trim: true
  },
  allowedDomains: [{
    type: String,
    trim: true,
    lowercase: true,
    set: normalizeDomain
  }],
  departments: {
    type: [departmentSchema],
    default: buildDefaultDepartments
  },
  securitySettings: {
    sessionVersion: {
      type: Number,
      default: 1
    },
    requireDomainMatch: {
      type: Boolean,
      default: false
    },
    passwordResetEnabled: {
      type: Boolean,
      default: true
    }
  },
  attendanceSettings: {
    qrTokenValiditySeconds: {
      type: Number,
      default: 30
    },
    allowPublicAttendance: {
      type: Boolean,
      default: true
    }
  },
  leaveSettings: {
    approvalRequired: {
      type: Boolean,
      default: true
    },
    defaultAnnualBalance: {
      type: Number,
      default: 0
    }
  },
  featureFlags: {
    multiOrganization: {
      type: Boolean,
      default: true
    },
    invitations: {
      type: Boolean,
      default: true
    },
    customBranding: {
      type: Boolean,
      default: true
    },
    qrCode: {
      type: Boolean,
      default: true
    },
    attendanceManagement: {
      type: Boolean,
      default: true
    },
    leaveManagement: {
      type: Boolean,
      default: true
    },
    messaging: {
      type: Boolean,
      default: true
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

organizationSchema.index({ allowedDomains: 1 });

organizationSchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  if (Array.isArray(this.allowedDomains)) {
    this.allowedDomains = [...new Set(this.allowedDomains
      .map((domain) => normalizeDomain(domain))
      .filter(Boolean))];
  }

  if (!Array.isArray(this.departments) || this.departments.length === 0) {
    this.departments = buildDefaultDepartments();
  }

  if (!this.subscription || typeof this.subscription !== 'object') {
    this.subscription = {};
  }

  if (this.plan) {
    this.plan = normalizeOrganizationPlan(this.plan);
  }

  if (!this.subscription.planCode && this.plan) {
    this.subscription.planCode = this.plan;
  }

  if (this.subscription.planCode) {
    this.subscription.planCode = normalizeOrganizationPlan(this.subscription.planCode);
    this.plan = this.subscription.planCode;
  }

  if (this.subscription.downgradePlanCode) {
    this.subscription.downgradePlanCode = normalizeOrganizationPlan(this.subscription.downgradePlanCode);
  }

  next();
});

module.exports = mongoose.model('Organization', organizationSchema);
