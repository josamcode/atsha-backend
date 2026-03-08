const crypto = require('crypto');
const User = require('../models/User');
const Organization = require('../models/Organization');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateResetToken
} = require('../utils/tokenUtils');
const {
  sendEmailToUser,
  getPasswordResetEmail,
  getPasswordResetRequestEmail,
  sendEmailToAdmins
} = require('../utils/emailService');
const { normalizeRole, toLegacyRole } = require('../utils/tenantConstants');

const buildOrganizationScopedEmailQuery = (email, organizationId) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const query = { email: normalizedEmail };

  if (!organizationId) {
    return query;
  }

  return {
    ...query,
    $or: [
      { organizationId },
      { organizationId: { $exists: false } },
      { organizationId: null }
    ]
  };
};

const buildScopedUserQuery = (userId, organizationId) => {
  const query = { _id: userId };

  if (!organizationId) {
    return query;
  }

  return {
    ...query,
    $or: [
      { organizationId },
      { organizationId: { $exists: false } },
      { organizationId: null }
    ]
  };
};

const formatOrganization = (organization) => {
  if (!organization) {
    return null;
  }

  return {
    id: organization._id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    locale: organization.locale,
    timezone: organization.timezone,
    branding: organization.branding || {},
    featureFlags: organization.featureFlags || {}
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

const getActiveOrganization = (req, res) => {
  if (!req.organization) {
    res.status(400).json({
      success: false,
      message: 'Organization context is required'
    });
    return null;
  }

  if (req.organization.status !== 'active') {
    res.status(403).json({
      success: false,
      message: 'Organization is not active'
    });
    return null;
  }

  return req.organization;
};

const ensureUserBelongsToOrganization = (user, organization, res) => {
  if (!user?.organizationId) {
    return true;
  }

  if (String(user.organizationId) !== String(organization._id)) {
    res.status(401).json({
      success: false,
      message: 'User does not belong to the active organization'
    });
    return false;
  }

  return true;
};

const buildAuthResponse = (user, organization, tokens = {}) => ({
  success: true,
  data: {
    user: formatUser(user),
    organization: formatOrganization(organization),
    ...tokens
  }
});

const attachLegacyUserToOrganization = async (user, organization) => {
  if (!user || user.organizationId || !organization?._id) {
    return;
  }

  await User.updateOne(
    {
      _id: user._id,
      $or: [
        { organizationId: { $exists: false } },
        { organizationId: null }
      ]
    },
    { $set: { organizationId: organization._id } }
  );

  user.organizationId = organization._id;
};

// @desc    Resolve organization bootstrap context
// @route   GET /api/auth/organization
// @access  Public
exports.getOrganizationContext = async (req, res) => {
  const organization = getActiveOrganization(req, res);
  if (!organization) {
    return;
  }

  res.json({
    success: true,
    data: {
      organization: formatOrganization(organization)
    }
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public (Admin only in production)
exports.register = async (req, res) => {
  try {
    const organization = getActiveOrganization(req, res);
    if (!organization) {
      return;
    }

    const {
      name,
      email,
      password,
      phone,
      role,
      department,
      departments,
      languagePreference
    } = req.body;

    const existingUser = await User.findOne(
      buildOrganizationScopedEmailQuery(email, organization._id)
    ).select('_id email organizationId').lean();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email in this organization'
      });
    }

    const user = await User.create({
      organizationId: organization._id,
      name,
      email,
      password,
      phone,
      role: role || 'employee',
      department: department || 'other',
      departments: departments || [],
      languagePreference: languagePreference || 'en'
    });

    const accessToken = generateAccessToken(user, organization);
    const refreshToken = generateRefreshToken(user, organization);

    await User.updateOne(
      { _id: user._id },
      { $set: { refreshToken } }
    );

    user.refreshToken = refreshToken;

    res.status(201).json(buildAuthResponse(user, organization, {
      accessToken,
      refreshToken
    }));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const organization = getActiveOrganization(req, res);
    if (!organization) {
      return;
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne(
      buildOrganizationScopedEmailQuery(email, organization._id)
    ).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!ensureUserBelongsToOrganization(user, organization, res)) {
      return;
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    await attachLegacyUserToOrganization(user, organization);

    const accessToken = generateAccessToken(user, organization);
    const refreshToken = generateRefreshToken(user, organization);

    await User.updateOne(
      { _id: user._id },
      { $set: { refreshToken } }
    );

    user.refreshToken = refreshToken;

    res.json(buildAuthResponse(user, organization, {
      accessToken,
      refreshToken
    }));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    let organization = req.organization;
    if (decoded.organizationId) {
      const tokenOrganization = await Organization.findById(decoded.organizationId).lean();

      if (!tokenOrganization) {
        return res.status(401).json({
          success: false,
          message: 'Organization not found for this session'
        });
      }

      if (organization && String(organization._id) !== String(tokenOrganization._id)) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token organization does not match the active organization'
        });
      }

      organization = tokenOrganization;
    }

    if (!organization) {
      return res.status(400).json({
        success: false,
        message: 'Organization context is required'
      });
    }

    if (organization.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Organization is not active'
      });
    }

    const user = await User.findOne(
      buildScopedUserQuery(decoded.id, organization._id)
    ).select('+refreshToken');

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    if (!ensureUserBelongsToOrganization(user, organization, res)) {
      return;
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated'
      });
    }

    if (decoded.role && normalizeRole(decoded.role) !== normalizeRole(user.role)) {
      return res.status(401).json({
        success: false,
        message: 'User role changed. Please sign in again.'
      });
    }

    const currentSessionVersion = organization.securitySettings?.sessionVersion || 1;
    if (decoded.sessionVersion && decoded.sessionVersion !== currentSessionVersion) {
      return res.status(401).json({
        success: false,
        message: 'Session is no longer valid. Please sign in again.'
      });
    }

    const accessToken = generateAccessToken(user, organization);

    res.json({
      success: true,
      data: {
        accessToken,
        organization: formatOrganization(organization)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
  try {
    await User.updateOne(
      buildScopedUserQuery(req.user.id, req.organization?._id),
      { $set: { refreshToken: null } }
    );

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findOne(
      buildScopedUserQuery(req.user.id, req.organization?._id)
    );

    res.json(buildAuthResponse(user || req.user, req.organization));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, languagePreference } = req.body;

    const user = await User.findOne(
      buildScopedUserQuery(req.user.id, req.organization?._id)
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (languagePreference) user.languagePreference = languagePreference;

    await user.save();

    res.json(buildAuthResponse(user, req.organization));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password'
      });
    }

    const user = await User.findOne(
      buildScopedUserQuery(req.user.id, req.organization?._id)
    ).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Forgot password (self-reset)
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const organization = getActiveOrganization(req, res);
    if (!organization) {
      return;
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    const user = await User.findOne(
      buildOrganizationScopedEmailQuery(email, organization._id)
    ).select('+resetPasswordToken +resetPasswordExpire');

    if (!user) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    }

    if (!ensureUserBelongsToOrganization(user, organization, res)) {
      return;
    }

    const resetToken = generateResetToken();
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = Date.now() + 60 * 60 * 1000;
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}?organization=${organization.slug}`;

    const userLanguage = user.languagePreference || 'ar';
    await sendEmailToUser(user.email, (language) => getPasswordResetEmail({
      resetLink: resetUrl,
      userName: user.name,
      expiresIn: '1 hour'
    }, language), userLanguage);

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Reset password with token
// @route   POST /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a new password'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpire');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    let organization = req.organization;
    if (!organization && user.organizationId) {
      organization = await Organization.findById(user.organizationId).lean();
    }

    if (organization && user.organizationId && String(user.organizationId) !== String(organization._id)) {
      return res.status(400).json({
        success: false,
        message: 'Reset token does not belong to the active organization'
      });
    }

    if (organization && organization.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Organization is not active'
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Request password reset from admin
// @route   POST /api/auth/request-password-reset
// @access  Public
exports.requestPasswordReset = async (req, res) => {
  try {
    const organization = getActiveOrganization(req, res);
    if (!organization) {
      return;
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    const user = await User.findOne(
      buildOrganizationScopedEmailQuery(email, organization._id)
    );

    if (!user) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset request has been sent to administrators'
      });
    }

    if (!ensureUserBelongsToOrganization(user, organization, res)) {
      return;
    }

    user.passwordResetRequested = true;
    user.passwordResetRequestDate = Date.now();
    await user.save();

    await sendEmailToAdmins(
      (language) => getPasswordResetRequestEmail({
        userName: user.name,
        userEmail: user.email,
        department: user.department,
        requestDate: user.passwordResetRequestDate
      }, language),
      user.department,
      organization._id
    );

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset request has been sent to administrators'
    });
  } catch (error) {
    console.error('Request password reset error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
