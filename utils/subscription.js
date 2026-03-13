const FormInstance = require('../models/FormInstance');
const FormTemplate = require('../models/FormTemplate');
const Message = require('../models/Message');
const SubscriptionUsage = require('../models/SubscriptionUsage');
const User = require('../models/User');
const { normalizeOrganizationPlan } = require('./tenantConstants');

const SUBSCRIPTION_FEATURE_KEYS = [
  'qrCode',
  'attendanceManagement',
  'leaveManagement',
  'messaging'
];

const SUBSCRIPTION_LIMIT_KEYS = [
  'formsPerMonth',
  'templatesTotal',
  'usersTotal',
  'messagesPerMonth'
];

const MONTHLY_LIMIT_KEYS = [
  'formsPerMonth',
  'messagesPerMonth'
];

const DEFAULT_DOWNGRADE_PLAN_CODE = 'free';

const DEFAULT_SUBSCRIPTION_PLANS = Object.freeze({
  free: {
    code: 'free',
    name: {
      en: 'Free',
      ar: 'ظ…ط¬ط§ظ†ظٹ'
    },
    description: {
      en: 'Entry plan for pilots and very small teams.',
      ar: 'ط®ط·ط© ط£ظˆظ„ظٹط© ظ„ظ„طھط¬ط±ط¨ط© ظˆط§ظ„ظپط±ظ‚ ط§ظ„طµط؛ظٹط±ط© ط¬ط¯ط§ظ‹.'
    },
    market: {
      primaryRegion: 'MENA',
      primaryCountry: 'SA',
      currency: 'SAR'
    },
    pricing: {
      monthly: {
        amount: 0,
        currency: 'SAR'
      },
      yearly: {
        amount: 0,
        currency: 'SAR'
      }
    },
    features: {
      qrCode: false,
      attendanceManagement: false,
      leaveManagement: false,
      messaging: false
    },
    limits: {
      formsPerMonth: 100,
      templatesTotal: 3,
      usersTotal: 5,
      messagesPerMonth: 0
    }
  },
  plus: {
    code: 'plus',
    name: {
      en: 'Plus',
      ar: 'ط¨ظ„ط³'
    },
    description: {
      en: 'For growing teams that need operational workflows and messaging.',
      ar: 'ظ„ظ„ظپط±ظ‚ ط§ظ„ظ…طھظ†ط§ظ…ظٹط© ط§ظ„طھظٹ طھط­طھط§ط¬ ط¥ظ„ظ‰ ط³ظٹط± ط¹ظ…ظ„ طھط´ط؛ظٹظ„ظٹ ظˆظ†ط¸ط§ظ… ظ…ط±ط§ط³ظ„ط©.'
    },
    market: {
      primaryRegion: 'MENA',
      primaryCountry: 'SA',
      currency: 'SAR'
    },
    pricing: {
      monthly: {
        amount: 149,
        currency: 'SAR'
      },
      yearly: {
        amount: 1490,
        currency: 'SAR'
      }
    },
    features: {
      qrCode: true,
      attendanceManagement: true,
      leaveManagement: false,
      messaging: true
    },
    limits: {
      formsPerMonth: 1000,
      templatesTotal: 15,
      usersTotal: 25,
      messagesPerMonth: 1000
    }
  },
  pro: {
    code: 'pro',
    name: {
      en: 'Pro',
      ar: 'ط¨ط±ظˆ'
    },
    description: {
      en: 'Full operating suite for larger organizations and regional rollout.',
      ar: 'ط¨ط§ظ‚ط© طھط´ط؛ظٹظ„ ظ…طھظƒط§ظ…ظ„ط© ظ„ظ„ظ…ظ†ط¸ظ…ط§طھ ط§ظ„ط£ظƒط¨ط± ظˆظ„ظ„طھظˆط³ط¹ ط§ظ„ط¥ظ‚ظ„ظٹظ…ظٹ.'
    },
    market: {
      primaryRegion: 'MENA',
      primaryCountry: 'SA',
      currency: 'SAR'
    },
    pricing: {
      monthly: {
        amount: 349,
        currency: 'SAR'
      },
      yearly: {
        amount: 3490,
        currency: 'SAR'
      }
    },
    features: {
      qrCode: true,
      attendanceManagement: true,
      leaveManagement: true,
      messaging: true
    },
    limits: {
      formsPerMonth: 10000,
      templatesTotal: 150,
      usersTotal: 200,
      messagesPerMonth: 20000
    }
  },
});

const createSubscriptionError = (
  statusCode,
  message,
  code = 'subscription_error',
  details = {}
) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
};

const normalizePlanCode = (value) => {
  const normalizedValue = normalizeOrganizationPlan(value);
  if (!normalizedValue) {
    return DEFAULT_DOWNGRADE_PLAN_CODE;
  }

  return normalizedValue;
};

const normalizeLimitValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return parsedValue < 0 ? null : parsedValue;
};

const normalizeFeatureValue = (value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return Boolean(value);
};

const isUnlimited = (value) => value === null || value === undefined;

const getPlanDefinition = (planCode) => {
  const normalizedPlanCode = normalizePlanCode(planCode);
  return DEFAULT_SUBSCRIPTION_PLANS[normalizedPlanCode]
    || DEFAULT_SUBSCRIPTION_PLANS[DEFAULT_DOWNGRADE_PLAN_CODE];
};

const buildMonthlyPeriod = (date = new Date()) => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));

  return {
    periodKey: `${year}-${String(month + 1).padStart(2, '0')}`,
    periodStart,
    periodEnd
  };
};

const countTemplates = (organizationId) => FormTemplate.countDocuments({ organizationId });
const countActiveUsers = (organizationId) => User.countDocuments({
  organizationId,
  isActive: true
});

const countLiveUsage = async (organizationId, metric, date = new Date()) => {
  const { periodStart, periodEnd } = buildMonthlyPeriod(date);

  if (metric === 'formsPerMonth') {
    return FormInstance.countDocuments({
      organizationId,
      createdAt: {
        $gte: periodStart,
        $lt: periodEnd
      }
    });
  }

  if (metric === 'messagesPerMonth') {
    return Message.countDocuments({
      organizationId,
      createdAt: {
        $gte: periodStart,
        $lt: periodEnd
      }
    });
  }

  return 0;
};

const getCurrentUsageValue = async (organizationId, metric, date = new Date()) => {
  const { periodKey } = buildMonthlyPeriod(date);
  const usageEntry = await SubscriptionUsage.findOne({
    organizationId,
    metric,
    periodKey
  })
    .select('used')
    .lean();

  if (usageEntry) {
    return usageEntry.used || 0;
  }

  return countLiveUsage(organizationId, metric, date);
};

const incrementMonthlyUsage = async ({
  organizationId,
  metric,
  amount = 1,
  date = new Date()
}) => {
  if (!MONTHLY_LIMIT_KEYS.includes(metric) || amount <= 0) {
    return null;
  }

  const { periodKey, periodStart, periodEnd } = buildMonthlyPeriod(date);
  const existingUsageEntry = await SubscriptionUsage.findOne({
    organizationId,
    metric,
    periodKey
  })
    .select('_id')
    .lean();

  if (!existingUsageEntry) {
    const liveUsageValue = await countLiveUsage(organizationId, metric, date);

    return SubscriptionUsage.findOneAndUpdate(
      {
        organizationId,
        metric,
        periodKey
      },
      {
        $set: {
          periodStart,
          periodEnd,
          used: liveUsageValue,
          lastIncrementedAt: date
        }
      },
      {
        new: true,
        upsert: true
      }
    );
  }

  return SubscriptionUsage.findOneAndUpdate(
    {
      organizationId,
      metric,
      periodKey
    },
    {
      $inc: {
        used: amount
      },
      $set: {
        lastIncrementedAt: date
      },
      $setOnInsert: {
        periodStart,
        periodEnd
      }
    },
    {
      new: true,
      upsert: true
    }
  );
};

const getTemplateLockLimit = (resolvedSubscription) => (
  resolvedSubscription?.entitlements?.limits?.templatesTotal
);

const resolveSubscriptionWindow = (organization, now = new Date()) => {
  const subscription = organization?.subscription || {};
  const startsAt = subscription.startsAt || null;
  const endsAt = subscription.endsAt || null;
  const graceEndsAt = subscription.graceEndsAt || null;
  const rawStatus = String(
    subscription.status || (organization?.status === 'active' ? 'active' : 'inactive')
  )
    .trim()
    .toLowerCase();
  const downgradePlanCode = normalizePlanCode(
    subscription.downgradePlanCode || DEFAULT_DOWNGRADE_PLAN_CODE
  );
  const subscribedPlanCode = normalizePlanCode(
    subscription.planCode || organization?.plan || 'free'
  );
  const isExpired = Boolean(endsAt && new Date(endsAt) <= now);
  const inGrace = Boolean(graceEndsAt && new Date(graceEndsAt) > now);
  const shouldDowngrade = (
    rawStatus === 'expired'
    || rawStatus === 'cancelled'
    || rawStatus === 'suspended'
    || (rawStatus === 'past_due' && !inGrace)
    || (isExpired && !inGrace)
  );

  return {
    startsAt,
    endsAt,
    graceEndsAt,
    rawStatus,
    subscribedPlanCode,
    downgradePlanCode,
    effectivePlanCode: shouldDowngrade ? downgradePlanCode : subscribedPlanCode,
    isDowngraded: shouldDowngrade,
    effectiveStatus: shouldDowngrade
      ? 'downgraded'
      : (rawStatus || 'active')
  };
};

const buildEntitlements = ({ organization, windowState }) => {
  const effectivePlan = getPlanDefinition(windowState.effectivePlanCode);
  const subscribedPlan = getPlanDefinition(windowState.subscribedPlanCode);
  const shouldApplyCustomOverrides = !windowState.isDowngraded;
  const customLimits = shouldApplyCustomOverrides
    ? organization?.subscription?.customLimits || {}
    : {};
  const customFeatures = shouldApplyCustomOverrides
    ? organization?.subscription?.customFeatures || {}
    : {};
  const effectiveLimits = { ...effectivePlan.limits };
  const effectiveFeatures = { ...effectivePlan.features };

  SUBSCRIPTION_LIMIT_KEYS.forEach((limitKey) => {
    if (customLimits[limitKey] !== undefined) {
      effectiveLimits[limitKey] = normalizeLimitValue(customLimits[limitKey]);
    } else {
      effectiveLimits[limitKey] = normalizeLimitValue(effectiveLimits[limitKey]);
    }
  });

  SUBSCRIPTION_FEATURE_KEYS.forEach((featureKey) => {
    if (customFeatures[featureKey] !== undefined) {
      effectiveFeatures[featureKey] = Boolean(customFeatures[featureKey]);
    } else {
      effectiveFeatures[featureKey] = Boolean(effectiveFeatures[featureKey]);
    }

    const organizationFeatureFlag = normalizeFeatureValue(
      organization?.featureFlags?.[featureKey]
    );

    if (organizationFeatureFlag === false) {
      effectiveFeatures[featureKey] = false;
    }
  });

  return {
    subscribedPlan,
    effectivePlan,
    limits: effectiveLimits,
    features: effectiveFeatures
  };
};

const resolveOrganizationSubscription = async (organization, options = {}) => {
  const { includeUsage = false } = options;
  const now = new Date();
  const windowState = resolveSubscriptionWindow(organization, now);
  const entitlements = buildEntitlements({
    organization,
    windowState
  });

  const result = {
    subscribedPlanCode: windowState.subscribedPlanCode,
    effectivePlanCode: windowState.effectivePlanCode,
    status: windowState.effectiveStatus,
    rawStatus: windowState.rawStatus,
    isDowngraded: windowState.isDowngraded,
    downgradePlanCode: windowState.downgradePlanCode,
    startedAt: windowState.startsAt,
    endsAt: windowState.endsAt,
    graceEndsAt: windowState.graceEndsAt,
    plan: {
      ...entitlements.effectivePlan
    },
    subscribedPlan: {
      ...entitlements.subscribedPlan
    },
    entitlements: {
      limits: entitlements.limits,
      features: entitlements.features
    }
  };

  if (!includeUsage || !organization?._id) {
    return result;
  }

  const [activeUsers, templatesTotal, formsPerMonthUsed, messagesPerMonthUsed] = await Promise.all([
    countActiveUsers(organization._id),
    countTemplates(organization._id),
    getCurrentUsageValue(organization._id, 'formsPerMonth', now),
    getCurrentUsageValue(organization._id, 'messagesPerMonth', now)
  ]);

  const formsPerMonthLimit = entitlements.limits.formsPerMonth;
  const messagesPerMonthLimit = entitlements.limits.messagesPerMonth;
  const templatesLimit = entitlements.limits.templatesTotal;
  const usersLimit = entitlements.limits.usersTotal;

  result.usage = {
    formsPerMonth: {
      used: formsPerMonthUsed,
      limit: formsPerMonthLimit,
      remaining: isUnlimited(formsPerMonthLimit)
        ? null
        : Math.max(formsPerMonthLimit - formsPerMonthUsed, 0)
    },
    messagesPerMonth: {
      used: messagesPerMonthUsed,
      limit: messagesPerMonthLimit,
      remaining: isUnlimited(messagesPerMonthLimit)
        ? null
        : Math.max(messagesPerMonthLimit - messagesPerMonthUsed, 0)
    },
    templatesTotal: {
      used: templatesTotal,
      limit: templatesLimit,
      remaining: isUnlimited(templatesLimit)
        ? null
        : Math.max(templatesLimit - templatesTotal, 0)
    },
    usersTotal: {
      used: activeUsers,
      limit: usersLimit,
      remaining: isUnlimited(usersLimit)
        ? null
        : Math.max(usersLimit - activeUsers, 0)
    }
  };

  result.locks = {
    templates: {
      limit: templatesLimit,
      total: templatesTotal,
      lockedCount: isUnlimited(templatesLimit)
        ? 0
        : Math.max(templatesTotal - templatesLimit, 0)
    }
  };

  return result;
};

const assertFeatureEnabled = async (organization, featureKey) => {
  const resolvedSubscription = await resolveOrganizationSubscription(organization);
  const featureEnabled = Boolean(
    resolvedSubscription?.entitlements?.features?.[featureKey]
  );

  if (featureEnabled) {
    return resolvedSubscription;
  }

  throw createSubscriptionError(
    403,
    `The "${featureKey}" feature is not available on the current subscription.`,
    'subscription_feature_disabled',
    {
      featureKey,
      planCode: resolvedSubscription.effectivePlanCode
    }
  );
};

const assertLimitAvailable = async ({
  organization,
  limitKey,
  currentUsage,
  incrementBy = 1,
  message
}) => {
  const resolvedSubscription = await resolveOrganizationSubscription(organization);
  const limitValue = resolvedSubscription?.entitlements?.limits?.[limitKey];

  if (isUnlimited(limitValue)) {
    return resolvedSubscription;
  }

  if ((currentUsage + incrementBy) <= limitValue) {
    return resolvedSubscription;
  }

  throw createSubscriptionError(
    403,
    message,
    'subscription_limit_exceeded',
    {
      limitKey,
      currentUsage,
      requestedIncrement: incrementBy,
      limitValue,
      planCode: resolvedSubscription.effectivePlanCode
    }
  );
};

const assertUserSeatAvailable = async (organization) => {
  const activeUsers = await countActiveUsers(organization._id);
  return assertLimitAvailable({
    organization,
    limitKey: 'usersTotal',
    currentUsage: activeUsers,
    message: 'Your organization has reached the active user limit for the current subscription.'
  });
};

const assertTemplateCreationAvailable = async (organization) => {
  const templatesTotal = await countTemplates(organization._id);
  return assertLimitAvailable({
    organization,
    limitKey: 'templatesTotal',
    currentUsage: templatesTotal,
    message: 'Your organization has reached the template limit for the current subscription.'
  });
};

const assertFormCreationAvailable = async (organization) => {
  const formsPerMonthUsed = await getCurrentUsageValue(organization._id, 'formsPerMonth');
  return assertLimitAvailable({
    organization,
    limitKey: 'formsPerMonth',
    currentUsage: formsPerMonthUsed,
    message: 'Your organization has reached the monthly forms limit for the current subscription.'
  });
};

const assertMessageSendAvailable = async (organization, incrementBy = 1) => {
  const messagesPerMonthUsed = await getCurrentUsageValue(organization._id, 'messagesPerMonth');
  return assertLimitAvailable({
    organization,
    limitKey: 'messagesPerMonth',
    currentUsage: messagesPerMonthUsed,
    incrementBy,
    message: 'Your organization has reached the monthly messaging limit for the current subscription.'
  });
};

const getLockedTemplateIdSet = async (organization) => {
  const resolvedSubscription = await resolveOrganizationSubscription(organization);
  const templateLimit = getTemplateLockLimit(resolvedSubscription);

  if (isUnlimited(templateLimit)) {
    return new Set();
  }

  const templateIds = await FormTemplate.find({
    organizationId: organization._id
  })
    .sort({ createdAt: 1, _id: 1 })
    .select('_id')
    .lean();

  return new Set(
    templateIds
      .slice(templateLimit)
      .map((entry) => String(entry._id))
  );
};

const annotateTemplatesWithSubscriptionAccess = async (organization, templates = []) => {
  if (!templates.length || !organization?._id) {
    return templates;
  }

  const [resolvedSubscription, lockedTemplateIds] = await Promise.all([
    resolveOrganizationSubscription(organization),
    getLockedTemplateIdSet(organization)
  ]);

  return templates.map((template) => {
    const source = template?.toObject ? template.toObject() : { ...template };
    const templateId = String(source._id || source.id || '');
    const locked = lockedTemplateIds.has(templateId);

    return {
      ...source,
      id: source._id || source.id,
      subscriptionAccess: {
        locked,
        reason: locked
          ? 'Locked because the organization is above the template limit for its active plan.'
          : null,
        planCode: resolvedSubscription.effectivePlanCode,
        limit: resolvedSubscription.entitlements?.limits?.templatesTotal ?? null
      }
    };
  });
};

const assertTemplateUnlocked = async (organization, template) => {
  if (!organization?._id || !template?._id) {
    return;
  }

  const lockedTemplateIds = await getLockedTemplateIdSet(organization);

  if (!lockedTemplateIds.has(String(template._id))) {
    return;
  }

  throw createSubscriptionError(
    403,
    'This template is locked because the organization is above the template limit for its active plan.',
    'subscription_resource_locked',
    {
      resourceType: 'form_template',
      resourceId: template._id
    }
  );
};

module.exports = {
  DEFAULT_SUBSCRIPTION_PLANS,
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_LIMIT_KEYS,
  annotateTemplatesWithSubscriptionAccess,
  assertFeatureEnabled,
  assertFormCreationAvailable,
  assertMessageSendAvailable,
  assertTemplateCreationAvailable,
  assertTemplateUnlocked,
  assertUserSeatAvailable,
  createSubscriptionError,
  getCurrentUsageValue,
  getLockedTemplateIdSet,
  getPlanDefinition,
  incrementMonthlyUsage,
  isUnlimited,
  normalizePlanCode,
  resolveOrganizationSubscription
};
