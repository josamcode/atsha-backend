const Organization = require('../models/Organization');
const User = require('../models/User');
const Invitation = require('../models/Invitation');
const { createAuditLog } = require('../utils/auditLogger');
const { deleteStoredAsset, uploadOrganizationBrandingAsset } = require('../utils/mediaStorage');
const { resolveManagedOrganization } = require('../utils/organizationAccess');
const { formatOrganizationForClient } = require('../utils/organizationFormatter');
const {
  getOrganizationPlanQueryValues,
  normalizeDepartmentCode,
  normalizeDomain,
  normalizeOrganizationPlan
} = require('../utils/tenantConstants');

const BRANDING_ASSET_FIELD_MAP = {
  logo: 'logoUrl',
  watermark: 'watermarkUrl'
};

const titleizeDepartment = (value) => value
  .split(/[-_]/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatOrganization = async (organization, options = {}) => {
  return formatOrganizationForClient(organization, options);
};

const parseAllowedDomains = (domains) => {
  if (!Array.isArray(domains)) {
    return undefined;
  }

  return [...new Set(domains
    .map((domain) => {
      if (typeof domain !== 'string') {
        return null;
      }

      const trimmed = domain.trim();
      if (!trimmed) {
        return null;
      }

      try {
        return new URL(trimmed).host.toLowerCase();
      } catch (error) {
        return normalizeDomain(trimmed.replace(/\/+$/g, '').replace(/:\d+$/, ''));
      }
    })
    .filter(Boolean))];
};

const parseDepartments = (departments) => {
  if (!Array.isArray(departments)) {
    return undefined;
  }

  const normalized = departments
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const code = normalizeDepartmentCode(entry);
        if (!code) {
          return null;
        }

        return {
          code,
          name: {
            en: titleizeDepartment(code),
            ar: titleizeDepartment(code)
          },
          isActive: true,
          sortOrder: index,
          isDefault: code === 'other'
        };
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const code = normalizeDepartmentCode(entry.code || entry.value || entry.slug || '');
      if (!code) {
        return null;
      }

      return {
        code,
        name: {
          en: entry.name?.en || entry.name || titleizeDepartment(code),
          ar: entry.name?.ar || entry.name?.en || entry.name || titleizeDepartment(code)
        },
        isActive: entry.isActive !== false,
        sortOrder: entry.sortOrder ?? index,
        isDefault: entry.isDefault === true || code === 'other'
      };
    })
    .filter(Boolean);

  return normalized.length > 0
    ? normalized.filter((entry, index, array) => array.findIndex((item) => item.code === entry.code) === index)
    : undefined;
};

const mergeObject = (currentValue, patchValue) => ({
  ...(currentValue || {}),
  ...(patchValue || {})
});

const sanitizeBrandingPatch = (branding) => {
  if (!branding || typeof branding !== 'object') {
    return undefined;
  }

  const { supportEmail, ...allowedBrandingFields } = branding;
  return Object.keys(allowedBrandingFields).length > 0 ? allowedBrandingFields : undefined;
};

const parseDateValue = (value) => {
  if (!value) {
    return null;
  }

  const parsedValue = new Date(value);
  return Number.isNaN(parsedValue.getTime()) ? null : parsedValue;
};

const sanitizeSubscriptionPatch = (subscription) => {
  if (!subscription || typeof subscription !== 'object') {
    return undefined;
  }

  const patch = {};

  if (subscription.planCode !== undefined) {
    patch.planCode = normalizeOrganizationPlan(subscription.planCode);
  }
  if (subscription.status !== undefined) patch.status = subscription.status;
  if (subscription.billingCycle !== undefined) patch.billingCycle = subscription.billingCycle;
  if (subscription.startsAt !== undefined) patch.startsAt = parseDateValue(subscription.startsAt);
  if (subscription.endsAt !== undefined) patch.endsAt = parseDateValue(subscription.endsAt);
  if (subscription.graceEndsAt !== undefined) patch.graceEndsAt = parseDateValue(subscription.graceEndsAt);
  if (subscription.downgradePlanCode !== undefined) patch.downgradePlanCode = subscription.downgradePlanCode;
  if (subscription.market && typeof subscription.market === 'object') patch.market = subscription.market;
  if (subscription.customLimits && typeof subscription.customLimits === 'object') patch.customLimits = subscription.customLimits;
  if (subscription.customFeatures && typeof subscription.customFeatures === 'object') patch.customFeatures = subscription.customFeatures;
  if (subscription.notes !== undefined) patch.notes = subscription.notes;

  return Object.keys(patch).length > 0 ? patch : undefined;
};

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

const getOrganizationSummary = async (organizationId) => {
  const [userCount, activeUserCount, pendingInvitationCount] = await Promise.all([
    User.countDocuments({ organizationId }),
    User.countDocuments({ organizationId, isActive: true }),
    Invitation.countDocuments({ organizationId, status: 'pending' })
  ]);

  return {
    users: userCount,
    activeUsers: activeUserCount,
    pendingInvitations: pendingInvitationCount
  };
};

const buildPlatformOrganizationPatch = (body) => {
  const patch = {};

  if (body.name !== undefined) patch.name = body.name;
  if (body.slug !== undefined) patch.slug = body.slug;
  if (body.status !== undefined) patch.status = body.status;
  if (body.plan !== undefined) patch.plan = normalizeOrganizationPlan(body.plan);
  if (body.locale !== undefined) patch.locale = body.locale;
  if (body.timezone !== undefined) patch.timezone = body.timezone;

  const allowedDomains = parseAllowedDomains(body.allowedDomains);
  if (allowedDomains !== undefined) patch.allowedDomains = allowedDomains;

  const departments = parseDepartments(body.departments);
  if (departments !== undefined) patch.departments = departments;

  const branding = sanitizeBrandingPatch(body.branding);
  if (branding) patch.branding = branding;
  if (body.securitySettings) patch.securitySettings = body.securitySettings;
  if (body.attendanceSettings) patch.attendanceSettings = body.attendanceSettings;
  if (body.leaveSettings) patch.leaveSettings = body.leaveSettings;
  if (body.featureFlags) patch.featureFlags = body.featureFlags;
  if (body.subscription) patch.subscription = sanitizeSubscriptionPatch(body.subscription);

  if (patch.plan !== undefined && !patch.subscription) {
    patch.subscription = {
      planCode: patch.plan
    };
  }

  return patch;
};

const buildSettingsPatch = (body) => {
  const patch = {};

  if (body.locale !== undefined) patch.locale = body.locale;
  if (body.timezone !== undefined) patch.timezone = body.timezone;

  const allowedDomains = parseAllowedDomains(body.allowedDomains);
  if (allowedDomains !== undefined) patch.allowedDomains = allowedDomains;

  const departments = parseDepartments(body.departments);
  if (departments !== undefined) patch.departments = departments;

  const branding = sanitizeBrandingPatch(body.branding);
  if (branding) patch.branding = branding;
  if (body.securitySettings) patch.securitySettings = body.securitySettings;
  if (body.attendanceSettings) patch.attendanceSettings = body.attendanceSettings;
  if (body.leaveSettings) patch.leaveSettings = body.leaveSettings;

  return patch;
};

// @desc    Get current organization context
// @route   GET /api/organizations/current
// @access  Private
exports.getCurrentOrganization = async (req, res) => {
  try {
    if (!req.organization) {
      return res.status(400).json({
        success: false,
        message: 'Organization context is required'
      });
    }

    const organization = await Organization.findById(req.organization._id);
    const summary = await getOrganizationSummary(req.organization._id);

    res.json({
      success: true,
      data: await formatOrganization(organization, {
        includeUsage: true,
        summary
      })
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get current organization settings
// @route   GET /api/organizations/current/settings
// @access  Private (Organization Admin, Platform Admin)
exports.getCurrentOrganizationSettings = async (req, res) => exports.getCurrentOrganization(req, res);

// @desc    Update current organization settings
// @route   PUT /api/organizations/current/settings
// @access  Private (Organization Admin, Platform Admin)
exports.updateCurrentOrganizationSettings = async (req, res) => {
  try {
    const organization = await resolveManagedOrganization(req);

    if (!organization) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to update organization settings'
      });
    }

    const patch = buildSettingsPatch(req.body);
    const previousState = {
      locale: organization.locale,
      timezone: organization.timezone,
      allowedDomains: organization.allowedDomains,
      departments: organization.departments,
      branding: organization.branding,
      securitySettings: organization.securitySettings,
      attendanceSettings: organization.attendanceSettings,
      leaveSettings: organization.leaveSettings
    };

    if (patch.locale !== undefined) organization.locale = patch.locale;
    if (patch.timezone !== undefined) organization.timezone = patch.timezone;
    if (patch.allowedDomains !== undefined) organization.allowedDomains = patch.allowedDomains;
    if (patch.departments !== undefined) organization.departments = patch.departments;
    if (patch.branding) organization.branding = mergeObject(organization.branding, patch.branding);
    if (patch.securitySettings) organization.securitySettings = mergeObject(organization.securitySettings, patch.securitySettings);
    if (patch.attendanceSettings) organization.attendanceSettings = mergeObject(organization.attendanceSettings, patch.attendanceSettings);
    if (patch.leaveSettings) organization.leaveSettings = mergeObject(organization.leaveSettings, patch.leaveSettings);

    await organization.save();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'organization.settings_updated',
      entityType: 'Organization',
      entityId: organization._id,
      metadata: {
        fields: Object.keys(patch),
        before: previousState,
        after: patch
      }
    });

    res.json({
      success: true,
      data: await formatOrganization(organization, {
        includeUsage: true
      })
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Upload current organization branding asset
// @route   POST /api/organizations/current/settings/branding-assets/:assetType
// @access  Private (Organization Admin, Platform Admin)
exports.uploadCurrentOrganizationBrandingAsset = async (req, res) => {
  let uploadedAssetUrl = null;

  try {
    const organization = await resolveManagedOrganization(req);

    if (!organization) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to update organization branding'
      });
    }

    const assetType = String(req.params.assetType || '').trim().toLowerCase();
    const brandingField = BRANDING_ASSET_FIELD_MAP[assetType];

    if (!brandingField) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported branding asset type'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required'
      });
    }

    if (!String(req.file.mimetype || '').startsWith('image/')) {
      return res.status(400).json({
        success: false,
        message: 'Only image uploads are allowed for branding assets'
      });
    }

    const previousAssetUrl = organization.branding?.[brandingField] || null;
    const uploadedAsset = await uploadOrganizationBrandingAsset(
      req.file,
      organization._id.toString(),
      assetType
    );

    uploadedAssetUrl = uploadedAsset.secure_url;
    organization.branding = mergeObject(organization.branding, {
      [brandingField]: uploadedAssetUrl
    });
    await organization.save();

    if (previousAssetUrl && previousAssetUrl !== uploadedAssetUrl) {
      try {
        await deleteStoredAsset(previousAssetUrl);
      } catch (cleanupError) {
        console.error('Error deleting previous organization branding asset:', cleanupError);
      }
    }

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'organization.branding_asset_updated',
      entityType: 'Organization',
      entityId: organization._id,
      metadata: {
        assetType,
        brandingField
      }
    });

    res.json({
      success: true,
      data: await formatOrganization(organization, {
        includeUsage: true
      }),
      assetType,
      url: uploadedAssetUrl
    });
  } catch (error) {
    if (uploadedAssetUrl) {
      try {
        await deleteStoredAsset(uploadedAssetUrl);
      } catch (cleanupError) {
        console.error('Error deleting uploaded branding asset after failure:', cleanupError);
      }
    }

    sendControllerError(res, error);
  }
};

// @desc    List organizations
// @route   GET /api/organizations
// @access  Private (Platform Admin)
exports.listOrganizations = async (req, res) => {
  try {
    const { status, plan, search, page = 1, limit = 25 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (plan) {
      const allowedPlanValues = getOrganizationPlanQueryValues(plan);
      if (allowedPlanValues.length === 1) {
        query.plan = allowedPlanValues[0];
      } else if (allowedPlanValues.length > 1) {
        query.plan = { $in: allowedPlanValues };
      }
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [organizations, total] = await Promise.all([
      Organization.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      Organization.countDocuments(query)
    ]);

    res.json({
      success: true,
      count: organizations.length,
      total,
      data: await Promise.all(
        organizations.map(async (organization) => formatOrganization(organization, {
          summary: await getOrganizationSummary(organization._id)
        }))
      )
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get organization by id
// @route   GET /api/organizations/:id
// @access  Private (Platform Admin)
exports.getOrganizationById = async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    const summary = await getOrganizationSummary(organization._id);

    res.json({
      success: true,
      data: await formatOrganization(organization, {
        includeUsage: true,
        summary
      })
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Create organization
// @route   POST /api/organizations
// @access  Private (Platform Admin)
exports.createOrganization = async (req, res) => {
  try {
    const patch = buildPlatformOrganizationPatch(req.body);

    if (!patch.name && !req.body.name) {
      return res.status(400).json({
        success: false,
        message: 'Organization name is required'
      });
    }

    const organization = await Organization.create({
      ...patch,
      name: req.body.name,
      createdBy: req.user._id
    });

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'organization.created',
      entityType: 'Organization',
      entityId: organization._id,
      metadata: {
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        plan: organization.plan
      }
    });

    res.status(201).json({
      success: true,
      data: await formatOrganization(organization, {
        includeUsage: true
      })
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Update organization
// @route   PUT /api/organizations/:id
// @access  Private (Platform Admin)
exports.updateOrganization = async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    const patch = buildPlatformOrganizationPatch(req.body);
    const previousState = {
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      plan: organization.plan,
      subscription: organization.subscription
    };

    if (patch.name !== undefined) organization.name = patch.name;
    if (patch.slug !== undefined) organization.slug = patch.slug;
    if (patch.status !== undefined) organization.status = patch.status;
    if (patch.plan !== undefined) organization.plan = patch.plan;
    if (patch.locale !== undefined) organization.locale = patch.locale;
    if (patch.timezone !== undefined) organization.timezone = patch.timezone;
    if (patch.allowedDomains !== undefined) organization.allowedDomains = patch.allowedDomains;
    if (patch.departments !== undefined) organization.departments = patch.departments;
    if (patch.branding) organization.branding = mergeObject(organization.branding, patch.branding);
    if (patch.securitySettings) organization.securitySettings = mergeObject(organization.securitySettings, patch.securitySettings);
    if (patch.attendanceSettings) organization.attendanceSettings = mergeObject(organization.attendanceSettings, patch.attendanceSettings);
    if (patch.leaveSettings) organization.leaveSettings = mergeObject(organization.leaveSettings, patch.leaveSettings);
    if (patch.featureFlags) organization.featureFlags = mergeObject(organization.featureFlags, patch.featureFlags);
    if (patch.subscription) {
      organization.subscription = mergeObject(organization.subscription, patch.subscription);
      if (patch.subscription.planCode) {
        organization.plan = patch.subscription.planCode;
      }
    }

    await organization.save();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'organization.updated',
      entityType: 'Organization',
      entityId: organization._id,
      metadata: {
        fields: Object.keys(patch),
        before: previousState,
        after: patch
      }
    });

    res.json({
      success: true,
      data: await formatOrganization(organization, {
        includeUsage: true
      })
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Update organization status
// @route   PATCH /api/organizations/:id/status
// @access  Private (Platform Admin)
exports.updateOrganizationStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const organization = await Organization.findById(req.params.id);

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    const previousStatus = organization.status;
    organization.status = status;

    if (previousStatus !== status && status !== 'active') {
      organization.securitySettings = {
        ...(organization.securitySettings || {}),
        sessionVersion: (organization.securitySettings?.sessionVersion || 1) + 1
      };
    }

    await organization.save();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'organization.status_changed',
      entityType: 'Organization',
      entityId: organization._id,
      metadata: {
        from: previousStatus,
        to: status
      }
    });

    res.json({
      success: true,
      data: await formatOrganization(organization, {
        includeUsage: true
      })
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
