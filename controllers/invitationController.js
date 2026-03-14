const crypto = require('crypto');
const Invitation = require('../models/Invitation');
const User = require('../models/User');
const { createAuditLog } = require('../utils/auditLogger');
const {
  ensureOrganizationAccess,
  resolveManagedOrganization
} = require('../utils/organizationAccess');
const { organizationIdsMatch, resolveOrganizationId } = require('../utils/organizationId');
const { sendEmailToUser, getInvitationEmail } = require('../utils/emailService');
const {
  normalizeDepartmentCode,
  normalizeRole,
  toLegacyRole
} = require('../utils/tenantConstants');
const {
  generateAccessToken,
  generateRefreshToken
} = require('../utils/tokenUtils');
const { formatOrganizationForClient } = require('../utils/organizationFormatter');
const { assertUserSeatAvailable } = require('../utils/subscription');

const formatOrganization = async (organization) => {
  const formattedOrganization = await formatOrganizationForClient(organization);

  return {
    id: formattedOrganization.id,
    name: formattedOrganization.name,
    slug: formattedOrganization.slug,
    status: formattedOrganization.status,
    locale: formattedOrganization.locale,
    timezone: formattedOrganization.timezone,
    branding: formattedOrganization.branding || {},
    featureFlags: formattedOrganization.featureFlags || {},
    subscription: formattedOrganization.subscription
  };
};

const formatInvitation = (invitation, options = {}) => {
  const source = invitation.toObject ? invitation.toObject() : invitation;

  return {
    ...source,
    id: source._id,
    role: toLegacyRole(source.role),
    organizationRole: normalizeRole(source.role),
    ...(options.activationUrl ? { activationUrl: options.activationUrl } : {}),
    ...(options.includeToken ? { token: options.includeToken } : {})
  };
};

const formatUser = (user) => ({
  id: user._id,
  organizationId: user.organizationId || null,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: toLegacyRole(user.role),
  organizationRole: normalizeRole(user.role),
  department: user.department,
  departments: user.departments,
  languagePreference: user.languagePreference,
  leaveBalance: user.leaveBalance,
  isActive: user.isActive,
  workDays: user.workDays || [],
  workSchedule: user.workSchedule || {}
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

const hashInvitationToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const buildActivationUrl = (organization, token) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${frontendUrl}/accept-invitation?token=${token}&organization=${organization.slug}`;
};

const getRequestedOrganizationId = (req) => (
  resolveOrganizationId(req.body.organizationId) ||
  resolveOrganizationId(req.query.organizationId) ||
  resolveOrganizationId(req.params.organizationId) ||
  null
);

const parseDepartments = (organization, body) => {
  const requestedDepartment = body.department ? normalizeDepartmentCode(body.department) : 'other';
  const requestedDepartments = Array.isArray(body.departments)
    ? body.departments.map((value) => normalizeDepartmentCode(value)).filter(Boolean)
    : [];

  const allowedDepartments = new Set((organization.departments || [])
    .filter((entry) => entry.isActive !== false)
    .map((entry) => entry.code));

  if (requestedDepartment && !allowedDepartments.has(requestedDepartment)) {
    throw new Error(`Department "${requestedDepartment}" is not configured for this organization`);
  }

  for (const department of requestedDepartments) {
    if (!allowedDepartments.has(department)) {
      throw new Error(`Department "${department}" is not configured for this organization`);
    }
  }

  return {
    department: requestedDepartment,
    departments: requestedDepartments
  };
};

const getInvitationWithOrganization = async (token) => {
  const tokenHash = hashInvitationToken(token);
  return Invitation.findOne({ tokenHash })
    .populate('organizationId')
    .populate('invitedBy', 'name email');
};

const expireInvitationIfNeeded = async (invitation) => {
  if (!invitation || invitation.status !== 'pending') {
    return invitation;
  }

  if (invitation.expiresAt <= new Date()) {
    invitation.status = 'expired';
    await invitation.save();
  }

  return invitation;
};

// @desc    List invitations
// @route   GET /api/invitations
// @access  Private (Organization Admin, Platform Admin)
exports.listInvitations = async (req, res) => {
  try {
    const organization = await resolveManagedOrganization(req, getRequestedOrganizationId(req));

    if (!organization || !ensureOrganizationAccess(req, organization._id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to invitation management for this organization'
      });
    }

    const { status, email, page = 1, limit = 25 } = req.query;
    const query = { organizationId: organization._id };

    if (status) query.status = status;
    if (email) query.email = { $regex: email, $options: 'i' };

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [invitations, total] = await Promise.all([
      Invitation.find(query)
        .populate('invitedBy', 'name email')
        .populate('acceptedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      Invitation.countDocuments(query)
    ]);

    res.json({
      success: true,
      count: invitations.length,
      total,
      data: invitations.map((invitation) => formatInvitation(invitation))
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Create invitation
// @route   POST /api/invitations
// @access  Private (Organization Admin, Platform Admin)
exports.createInvitation = async (req, res) => {
  try {
    const organization = await resolveManagedOrganization(req, getRequestedOrganizationId(req));

    if (!organization || !ensureOrganizationAccess(req, organization._id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to create invitations for this organization'
      });
    }

    if (organization.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Cannot invite users into an inactive organization'
      });
    }

    const { email, role = 'employee', languagePreference = 'en', expiresInDays = 7, metadata = {} } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Invitee email is required'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const canonicalRole = normalizeRole(role);
    const departmentInfo = parseDepartments(organization, req.body);

    await assertUserSeatAvailable(organization);

    await Invitation.updateMany(
      {
        organizationId: organization._id,
        email: normalizedEmail,
        status: 'pending',
        expiresAt: { $lte: new Date() }
      },
      { $set: { status: 'expired' } }
    );

    const existingUser = await User.findOne({
      email: normalizedEmail,
      organizationId: organization._id
    }).select('_id email');

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists in the target organization'
      });
    }

    const existingPendingInvitation = await Invitation.findOne({
      organizationId: organization._id,
      email: normalizedEmail,
      status: 'pending'
    }).select('_id email expiresAt');

    if (existingPendingInvitation) {
      return res.status(400).json({
        success: false,
        message: 'A pending invitation already exists for this email'
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);

    const invitation = await Invitation.create({
      organizationId: organization._id,
      email: normalizedEmail,
      role: canonicalRole,
      department: departmentInfo.department,
      departments: departmentInfo.departments,
      languagePreference,
      tokenHash: hashInvitationToken(rawToken),
      invitedBy: req.user._id,
      expiresAt,
      metadata
    });

    const activationUrl = buildActivationUrl(organization, rawToken);

    await sendEmailToUser(normalizedEmail, (language) => getInvitationEmail({
      organizationName: organization.branding?.displayName || organization.name,
      inviterName: req.user.name,
      inviteLink: activationUrl,
      role: toLegacyRole(canonicalRole),
      department: departmentInfo.department,
      expiresAt
    }, language), languagePreference);

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'invitation.created',
      entityType: 'Invitation',
      entityId: invitation._id,
      metadata: {
        email: normalizedEmail,
        role: canonicalRole,
        department: departmentInfo.department,
        departments: departmentInfo.departments,
        expiresAt
      }
    });

    res.status(201).json({
      success: true,
      data: formatInvitation(invitation, {
        activationUrl,
        includeToken: process.env.NODE_ENV === 'development' ? rawToken : undefined
      })
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get invitation preview
// @route   GET /api/invitations/public/:token
// @access  Public
exports.getInvitationPreview = async (req, res) => {
  try {
    const invitation = await expireInvitationIfNeeded(await getInvitationWithOrganization(req.params.token));

    if (!invitation || invitation.status !== 'pending') {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found or is no longer active'
      });
    }

    const organization = invitation.organizationId;
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found for this invitation'
      });
    }

    if (req.organization && !organizationIdsMatch(req.organization, organization)) {
      return res.status(400).json({
        success: false,
        message: 'Invitation does not belong to the active organization'
      });
    }

    if (organization.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Organization is not active'
      });
    }

    res.json({
      success: true,
      data: {
        invitation: formatInvitation(invitation),
        organization: await formatOrganization(organization)
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Accept invitation
// @route   POST /api/invitations/accept
// @access  Public
exports.acceptInvitation = async (req, res) => {
  try {
    const { token, name, password, phone, languagePreference } = req.body;

    if (!token || !name || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token, name, and password are required'
      });
    }

    const invitation = await expireInvitationIfNeeded(await getInvitationWithOrganization(token));

    if (!invitation || invitation.status !== 'pending') {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found or is no longer active'
      });
    }

    const organization = invitation.organizationId;
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found for this invitation'
      });
    }

    if (req.organization && !organizationIdsMatch(req.organization, organization)) {
      return res.status(400).json({
        success: false,
        message: 'Invitation does not belong to the active organization'
      });
    }

    if (organization.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Organization is not active'
      });
    }

    const existingUser = await User.findOne({
      email: invitation.email,
      organizationId: organization._id
    }).select('_id');

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists in the organization'
      });
    }

    await assertUserSeatAvailable(organization);

    const user = await User.create({
      organizationId: organization._id,
      name,
      email: invitation.email,
      password,
      phone,
      role: toLegacyRole(invitation.role),
      department: invitation.department,
      departments: invitation.departments || [],
      languagePreference: languagePreference || invitation.languagePreference || organization.locale || 'en'
    });

    const accessToken = generateAccessToken(user, organization);
    const refreshToken = generateRefreshToken(user, organization);

    await User.updateOne(
      { _id: user._id },
      { $set: { refreshToken } }
    );

    invitation.status = 'accepted';
    invitation.acceptedBy = user._id;
    invitation.acceptedAt = new Date();
    await invitation.save();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: user._id,
      action: 'invitation.accepted',
      entityType: 'Invitation',
      entityId: invitation._id,
      metadata: {
        email: invitation.email,
        invitedBy: invitation.invitedBy?._id || invitation.invitedBy,
        createdUserId: user._id
      }
    });

    res.status(201).json({
      success: true,
      data: {
        user: formatUser(user),
        organization: await formatOrganization(organization),
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Cancel invitation
// @route   PUT /api/invitations/:id/cancel
// @access  Private (Organization Admin, Platform Admin)
exports.cancelInvitation = async (req, res) => {
  try {
    const invitation = await Invitation.findById(req.params.id);

    if (!invitation) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
    }

    if (!ensureOrganizationAccess(req, invitation.organizationId)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to cancel this invitation'
      });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending invitations can be cancelled'
      });
    }

    invitation.status = 'cancelled';
    await invitation.save();

    await createAuditLog({
      req,
      organizationId: invitation.organizationId,
      actorUserId: req.user._id,
      action: 'invitation.cancelled',
      entityType: 'Invitation',
      entityId: invitation._id,
      metadata: {
        email: invitation.email
      }
    });

    res.json({
      success: true,
      data: formatInvitation(invitation)
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
