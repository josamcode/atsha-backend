const Organization = require('../models/Organization');
const PlatformConfig = require('../models/PlatformConfig');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const User = require('../models/User');
const { createAuditLog } = require('../utils/auditLogger');
const {
  DEFAULT_PLATFORM_PROFILE,
  DEFAULT_SUBSCRIPTION_PLANS
} = require('../utils/platformDefaults');
const {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_LIMIT_KEYS,
  getSubscriptionPlans,
  normalizePlanCode
} = require('../utils/subscription');
const { slugPattern } = require('../utils/tenantConstants');

const mergeObject = (currentValue, patchValue) => ({
  ...(currentValue || {}),
  ...(patchValue || {})
});

const sendControllerError = (res, error) => {
  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate field value entered'
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors).map((entry) => entry.message).join(', ')
    });
  }

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message
  });
};

const getPlatformProfile = (config) => ({
  ...DEFAULT_PLATFORM_PROFILE,
  ...(config?.profile || {})
});

const getOrCreatePlatformConfig = async () => {
  let config = await PlatformConfig.findOne({ key: 'global' });

  if (!config) {
    config = await PlatformConfig.create({
      key: 'global',
      profile: { ...DEFAULT_PLATFORM_PROFILE }
    });
  }

  return config;
};

const buildPlatformSummary = async () => {
  const [
    organizationsTotal,
    organizationsActive,
    usersTotal,
    usersActive,
    resetRequests
  ] = await Promise.all([
    Organization.countDocuments({}),
    Organization.countDocuments({ status: 'active' }),
    User.countDocuments({}),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ passwordResetRequested: true })
  ]);

  return {
    organizationsTotal,
    organizationsActive,
    usersTotal,
    usersActive,
    resetRequests
  };
};

const sanitizeProfilePatch = (profile = {}) => {
  const patch = {};

  if (profile.platformName !== undefined) {
    patch.platformName = String(profile.platformName || '').trim() || DEFAULT_PLATFORM_PROFILE.platformName;
  }

  if (profile.supportEmail !== undefined) {
    patch.supportEmail = String(profile.supportEmail || '').trim().toLowerCase();
  }

  if (profile.websiteUrl !== undefined) {
    patch.websiteUrl = String(profile.websiteUrl || '').trim();
  }

  if (profile.locale !== undefined) {
    patch.locale = String(profile.locale || '').trim() || DEFAULT_PLATFORM_PROFILE.locale;
  }

  if (profile.timezone !== undefined) {
    patch.timezone = String(profile.timezone || '').trim() || DEFAULT_PLATFORM_PROFILE.timezone;
  }

  if (profile.defaultOrganizationPlan !== undefined) {
    const normalizedPlanCode = normalizePlanCode(profile.defaultOrganizationPlan);
    if (!slugPattern.test(normalizedPlanCode)) {
      const error = new Error('Invalid default organization plan code');
      error.statusCode = 400;
      throw error;
    }

    patch.defaultOrganizationPlan = normalizedPlanCode;
  }

  if (profile.allowOrganizationRegistration !== undefined) {
    patch.allowOrganizationRegistration = profile.allowOrganizationRegistration !== false;
  }

  return patch;
};

const sanitizePlanPayload = (source = {}) => {
  const code = normalizePlanCode(source.code);
  if (!code || !slugPattern.test(code)) {
    const error = new Error('Plan code must use lowercase letters, numbers, and hyphens only');
    error.statusCode = 400;
    throw error;
  }

  const nameEn = String(source?.name?.en || '').trim();
  if (!nameEn) {
    const error = new Error('English plan name is required');
    error.statusCode = 400;
    throw error;
  }

  const plan = {
    code,
    name: {
      en: nameEn,
      ar: String(source?.name?.ar || '').trim()
    },
    description: {
      en: String(source?.description?.en || '').trim(),
      ar: String(source?.description?.ar || '').trim()
    },
    market: {
      primaryRegion: String(source?.market?.primaryRegion || 'MENA').trim() || 'MENA',
      primaryCountry: String(source?.market?.primaryCountry || 'SA').trim() || 'SA',
      currency: String(source?.market?.currency || 'SAR').trim().toUpperCase() || 'SAR'
    },
    pricing: {
      monthly: {
        amount: Number(source?.pricing?.monthly?.amount) || 0,
        currency: String(source?.pricing?.monthly?.currency || source?.market?.currency || 'SAR').trim().toUpperCase() || 'SAR'
      },
      yearly: {
        amount: Number(source?.pricing?.yearly?.amount) || 0,
        currency: String(source?.pricing?.yearly?.currency || source?.market?.currency || 'SAR').trim().toUpperCase() || 'SAR'
      }
    },
    features: {},
    limits: {},
    isActive: source.isActive !== false,
    sortOrder: Number.isFinite(Number(source.sortOrder)) ? Number(source.sortOrder) : 0
  };

  SUBSCRIPTION_FEATURE_KEYS.forEach((featureKey) => {
    plan.features[featureKey] = Boolean(source?.features?.[featureKey]);
  });

  SUBSCRIPTION_LIMIT_KEYS.forEach((limitKey) => {
    const value = source?.limits?.[limitKey];
    if (value === null || value === undefined || value === '') {
      plan.limits[limitKey] = null;
      return;
    }

    const normalizedValue = Number(value);
    plan.limits[limitKey] = Number.isFinite(normalizedValue) && normalizedValue >= 0
      ? normalizedValue
      : null;
  });

  return plan;
};

exports.getPlatformSettings = async (req, res) => {
  try {
    const [config, plans, summary] = await Promise.all([
      PlatformConfig.findOne({ key: 'global' }).lean(),
      getSubscriptionPlans({ includeInactive: true }),
      buildPlatformSummary()
    ]);

    res.json({
      success: true,
      data: {
        profile: getPlatformProfile(config),
        plans,
        summary
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

exports.updatePlatformSettings = async (req, res) => {
  try {
    const config = await getOrCreatePlatformConfig();
    const profilePatch = sanitizeProfilePatch(req.body?.profile || {});
    if (profilePatch.defaultOrganizationPlan) {
      const availablePlans = await getSubscriptionPlans({ includeInactive: true });
      if (!availablePlans.some((plan) => plan.code === profilePatch.defaultOrganizationPlan)) {
        return res.status(400).json({
          success: false,
          message: 'Default organization plan was not found'
        });
      }
    }
    const previousState = {
      profile: getPlatformProfile(config)
    };

    config.profile = mergeObject(getPlatformProfile(config), profilePatch);
    await config.save();

    await createAuditLog({
      req,
      organizationId: req.organization?._id || req.user?.organizationId || null,
      actorUserId: req.user._id,
      action: 'platform.settings_updated',
      entityType: 'PlatformConfig',
      entityId: config._id,
      metadata: {
        before: previousState,
        after: {
          profile: profilePatch
        }
      }
    });

    const [plans, summary] = await Promise.all([
      getSubscriptionPlans({ includeInactive: true }),
      buildPlatformSummary()
    ]);

    res.json({
      success: true,
      data: {
        profile: getPlatformProfile(config),
        plans,
        summary
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

exports.listSubscriptionPlans = async (req, res) => {
  try {
    const plans = await getSubscriptionPlans({
      includeInactive: req.query.includeInactive === 'true'
    });

    res.json({
      success: true,
      count: plans.length,
      data: plans
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

exports.createSubscriptionPlan = async (req, res) => {
  try {
    const payload = sanitizePlanPayload(req.body);
    const existingPlan = await SubscriptionPlan.findOne({ code: payload.code }).lean();

    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: 'Plan code already exists'
      });
    }

    if (DEFAULT_SUBSCRIPTION_PLANS[payload.code]) {
      return res.status(400).json({
        success: false,
        message: 'Use the update endpoint to customize a built-in plan'
      });
    }

    const plan = await SubscriptionPlan.create(payload);

    await createAuditLog({
      req,
      organizationId: req.organization?._id || req.user?.organizationId || null,
      actorUserId: req.user._id,
      action: 'platform.subscription_plan_created',
      entityType: 'SubscriptionPlan',
      entityId: plan._id,
      metadata: {
        code: plan.code
      }
    });

    res.status(201).json({
      success: true,
      data: plan
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

exports.updateSubscriptionPlan = async (req, res) => {
  try {
    const code = normalizePlanCode(req.params.code);
    const payload = sanitizePlanPayload({
      ...req.body,
      code
    });
    const existingPlan = await SubscriptionPlan.findOne({ code });
    const previousState = existingPlan?.toObject ? existingPlan.toObject() : null;
    const plan = existingPlan || new SubscriptionPlan({ code });

    Object.assign(plan, payload);
    await plan.save();

    await createAuditLog({
      req,
      organizationId: req.organization?._id || req.user?.organizationId || null,
      actorUserId: req.user._id,
      action: 'platform.subscription_plan_updated',
      entityType: 'SubscriptionPlan',
      entityId: plan._id,
      metadata: {
        code: plan.code,
        before: previousState
      }
    });

    res.json({
      success: true,
      data: plan
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
