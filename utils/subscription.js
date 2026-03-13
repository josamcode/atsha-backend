const FormInstance = require('../models/FormInstance');
const FormTemplate = require('../models/FormTemplate');
const Message = require('../models/Message');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const SubscriptionUsage = require('../models/SubscriptionUsage');
const User = require('../models/User');
const { normalizeOrganizationPlan } = require('./tenantConstants');
const { DEFAULT_SUBSCRIPTION_PLANS } = require('./platformDefaults');

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

const buildEmptyPlanDefinition = (planCode = DEFAULT_DOWNGRADE_PLAN_CODE) => ({
  code: normalizePlanCode(planCode),
  name: {
    en: String(planCode || DEFAULT_DOWNGRADE_PLAN_CODE).toUpperCase(),
    ar: String(planCode || DEFAULT_DOWNGRADE_PLAN_CODE).toUpperCase()
  },
  description: {
    en: '',
    ar: ''
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
    formsPerMonth: null,
    templatesTotal: null,
    usersTotal: null,
    messagesPerMonth: null
  },
  isActive: true,
  sortOrder: 0
});

const clonePlanRecord = (value) => JSON.parse(JSON.stringify(value || {}));

const normalizePlanRecord = (source, fallback = {}) => {
  const baseValue = buildEmptyPlanDefinition(source?.code || fallback?.code);
  const mergedValue = {
    ...baseValue,
    ...clonePlanRecord(fallback),
    ...clonePlanRecord(source),
    name: {
      ...baseValue.name,
      ...(fallback?.name || {}),
      ...(source?.name || {})
    },
    description: {
      ...baseValue.description,
      ...(fallback?.description || {}),
      ...(source?.description || {})
    },
    market: {
      ...baseValue.market,
      ...(fallback?.market || {}),
      ...(source?.market || {})
    },
    pricing: {
      monthly: {
        ...baseValue.pricing.monthly,
        ...(fallback?.pricing?.monthly || {}),
        ...(source?.pricing?.monthly || {})
      },
      yearly: {
        ...baseValue.pricing.yearly,
        ...(fallback?.pricing?.yearly || {}),
        ...(source?.pricing?.yearly || {})
      }
    },
    features: {
      ...baseValue.features,
      ...(fallback?.features || {}),
      ...(source?.features || {})
    },
    limits: {
      ...baseValue.limits,
      ...(fallback?.limits || {}),
      ...(source?.limits || {})
    }
  };

  mergedValue.code = normalizePlanCode(mergedValue.code);
  mergedValue.isActive = mergedValue.isActive !== false;
  mergedValue.sortOrder = Number.isFinite(Number(mergedValue.sortOrder))
    ? Number(mergedValue.sortOrder)
    : 0;

  SUBSCRIPTION_LIMIT_KEYS.forEach((limitKey) => {
    mergedValue.limits[limitKey] = normalizeLimitValue(mergedValue.limits?.[limitKey]);
  });

  SUBSCRIPTION_FEATURE_KEYS.forEach((featureKey) => {
    mergedValue.features[featureKey] = Boolean(mergedValue.features?.[featureKey]);
  });

  return mergedValue;
};

const getSubscriptionPlans = async ({ includeInactive = false } = {}) => {
  const storedPlans = await SubscriptionPlan.find({})
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  const defaultPlans = Object.values(DEFAULT_SUBSCRIPTION_PLANS)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  const planMap = new Map(
    defaultPlans.map((plan, index) => {
      const normalizedPlan = normalizePlanRecord(plan, {
        sortOrder: plan.sortOrder ?? index
      });

      return [normalizedPlan.code, {
        ...normalizedPlan,
        isDefault: true,
        source: 'default'
      }];
    })
  );

  storedPlans.forEach((storedPlan, index) => {
    const normalizedCode = normalizePlanCode(storedPlan.code);
    const existingPlan = planMap.get(normalizedCode);
    const normalizedPlan = normalizePlanRecord(storedPlan, existingPlan || {
      ...buildEmptyPlanDefinition(normalizedCode),
      sortOrder: defaultPlans.length + index
    });

    planMap.set(normalizedCode, {
      ...normalizedPlan,
      isDefault: Boolean(DEFAULT_SUBSCRIPTION_PLANS[normalizedCode]),
      source: DEFAULT_SUBSCRIPTION_PLANS[normalizedCode]
        ? 'customized_default'
        : 'custom'
    });
  });

  return Array.from(planMap.values())
    .filter((plan) => includeInactive || plan.isActive !== false)
    .sort((left, right) => {
      const sortDifference = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
      if (sortDifference !== 0) {
        return sortDifference;
      }

      return String(left.code || '').localeCompare(String(right.code || ''));
    });
};

const getPlanCatalogMap = async (options = {}) => {
  const plans = await getSubscriptionPlans({
    includeInactive: true,
    ...options
  });

  return plans.reduce((result, plan) => {
    result[plan.code] = plan;
    return result;
  }, {});
};

const getPlanDefinition = async (planCode) => {
  const normalizedPlanCode = normalizePlanCode(planCode);
  const planCatalogMap = await getPlanCatalogMap();

  return planCatalogMap[normalizedPlanCode]
    || planCatalogMap[DEFAULT_DOWNGRADE_PLAN_CODE]
    || normalizePlanRecord(DEFAULT_SUBSCRIPTION_PLANS[DEFAULT_DOWNGRADE_PLAN_CODE]);
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
    subscription.planCode || organization?.plan || DEFAULT_DOWNGRADE_PLAN_CODE
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

const buildEntitlements = ({ organization, windowState, planCatalogMap }) => {
  const effectivePlan = planCatalogMap[windowState.effectivePlanCode]
    || planCatalogMap[DEFAULT_DOWNGRADE_PLAN_CODE]
    || normalizePlanRecord(DEFAULT_SUBSCRIPTION_PLANS[DEFAULT_DOWNGRADE_PLAN_CODE]);
  const subscribedPlan = planCatalogMap[windowState.subscribedPlanCode]
    || effectivePlan;
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
  const planCatalogMap = await getPlanCatalogMap();
  const entitlements = buildEntitlements({
    organization,
    windowState,
    planCatalogMap
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
    message: 'لقد وصلت مؤسستك إلى الحد الأقصى لعدد المستخدمين النشطين في الاشتراك الحالي.'
  });
};

const assertTemplateCreationAvailable = async (organization) => {
  const templatesTotal = await countTemplates(organization._id);
  return assertLimitAvailable({
    organization,
    limitKey: 'templatesTotal',
    currentUsage: templatesTotal,
    message: 'لقد وصلت مؤسستك إلى الحد الأقصى لعدد القوالب في الاشتراك الحالي.'
  });
};

const assertFormCreationAvailable = async (organization) => {
  const formsPerMonthUsed = await getCurrentUsageValue(organization._id, 'formsPerMonth');
  return assertLimitAvailable({
    organization,
    limitKey: 'formsPerMonth',
    currentUsage: formsPerMonthUsed,
    message: 'لقد وصلت مؤسستك إلى الحد الأقصى لعدد النماذج المسموح بها شهريًا في الاشتراك الحالي.'
  });
};

const assertMessageSendAvailable = async (organization, incrementBy = 1) => {
  const messagesPerMonthUsed = await getCurrentUsageValue(organization._id, 'messagesPerMonth');
  return assertLimitAvailable({
    organization,
    limitKey: 'messagesPerMonth',
    currentUsage: messagesPerMonthUsed,
    incrementBy,
    message: 'لقد وصلت مؤسستك إلى الحد الأقصى لعدد الرسائل المسموح بها شهريًا في الاشتراك الحالي.'
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
  getSubscriptionPlans,
  incrementMonthlyUsage,
  isUnlimited,
  normalizePlanCode,
  resolveOrganizationSubscription
};
