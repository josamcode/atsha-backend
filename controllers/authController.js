const crypto = require('crypto');
const User = require('../models/User');
const Organization = require('../models/Organization');
const OrganizationRegistrationVerification = require('../models/OrganizationRegistrationVerification');
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
  getOrganizationRegistrationVerificationEmail,
  sendEmailToAdmins
} = require('../utils/emailService');
const { formatOrganizationForClient } = require('../utils/organizationFormatter');
const {
  LEGACY_DEPARTMENTS,
  normalizeRole,
  toLegacyRole
} = require('../utils/tenantConstants');
const { assertUserSeatAvailable } = require('../utils/subscription');

const ORGANIZATION_EMAIL_VERIFICATION_EXPIRY_MINUTES = 10;
const ORGANIZATION_EMAIL_VERIFICATION_CODE_LENGTH = 6;
const ORGANIZATION_REGISTRATION_SLUG_RETRY_LIMIT = 3;

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();
const hashTokenValue = (value = '') => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const buildOrganizationVerificationExpiryDate = () => new Date(
  Date.now() + (ORGANIZATION_EMAIL_VERIFICATION_EXPIRY_MINUTES * 60 * 1000)
);
const buildOrganizationVerificationExpiryLabel = (language = 'en') => (
  language === 'ar'
    ? `${ORGANIZATION_EMAIL_VERIFICATION_EXPIRY_MINUTES} دقائق`
    : `${ORGANIZATION_EMAIL_VERIFICATION_EXPIRY_MINUTES} minutes`
);
const generateOrganizationVerificationCode = () => crypto.randomInt(
  0,
  10 ** ORGANIZATION_EMAIL_VERIFICATION_CODE_LENGTH
).toString().padStart(ORGANIZATION_EMAIL_VERIFICATION_CODE_LENGTH, '0');

const buildOrganizationScopedEmailQuery = (email, organizationId) => {
  const normalizedEmail = normalizeEmail(email);
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

const buildOrganizationScopedLoginQuery = (email, organizationId) => (
  buildOrganizationScopedEmailQuery(email, organizationId)
);

const titleizeDepartment = (value = 'other') => value
  .split(/[-_]/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const buildFallbackDepartments = () => LEGACY_DEPARTMENTS.map((code, index) => ({
  code,
  name: {
    en: titleizeDepartment(code),
    ar: titleizeDepartment(code)
  },
  isActive: true,
  sortOrder: index,
  isDefault: code === 'other'
}));

const getOrganizationDepartments = (organization) => {
  const departments = Array.isArray(organization?.departments)
    ? organization.departments.filter((entry) => entry?.code)
    : [];

  return departments.length > 0 ? departments : buildFallbackDepartments();
};

const slugifyOrganizationName = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'organization';

const resolveAvailableOrganizationSlug = async (organizationName, preferredSlug) => {
  const baseSlug = slugifyOrganizationName(preferredSlug || organizationName);
  let candidateSlug = baseSlug;
  let counter = 2;

  while (await Organization.exists({ slug: candidateSlug })) {
    candidateSlug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return candidateSlug;
};

const findSingleActiveOrganization = async () => {
  const organizations = await Organization.find({ status: 'active' })
    .sort({ createdAt: 1 })
    .limit(2)
    .lean();

  return organizations.length === 1 ? organizations[0] : null;
};

const resolveOrganizationForUser = async (user) => {
  if (!user) {
    return null;
  }

  if (user.organizationId) {
    return Organization.findById(user.organizationId).lean();
  }

  return findSingleActiveOrganization();
};

const buildOrganizationRegistrationPayload = async ({ organizationName, organizationSlug, email }) => ({
  name: organizationName,
  slug: await resolveAvailableOrganizationSlug(organizationName, organizationSlug),
  status: 'active',
  plan: 'free',
  subscription: {
    planCode: 'free',
    status: 'active',
    billingCycle: 'monthly',
    startsAt: new Date(),
    downgradePlanCode: 'free',
    market: {
      primaryRegion: 'MENA',
      primaryCountry: 'SA',
      currency: 'SAR'
    }
  },
  locale: 'en',
  timezone: 'Africa/Cairo',
  branding: {
    displayName: organizationName,
    shortName: organizationName,
    legalName: organizationName,
    supportEmail: normalizeEmail(email),
    emailFromName: organizationName
  }
});

const claimOrganizationRegistrationVerification = async (email, verificationToken) => (
  OrganizationRegistrationVerification.findOneAndUpdate(
    {
      email: normalizeEmail(email),
      verificationTokenHash: hashTokenValue(verificationToken),
      verifiedAt: { $ne: null },
      consumedAt: null,
      expiresAt: { $gt: new Date() }
    },
    {
      $set: {
        consumedAt: new Date()
      }
    },
    {
      new: true
    }
  )
);

const getDuplicateKeyFields = (error) => {
  if (error?.keyPattern && typeof error.keyPattern === 'object') {
    return Object.keys(error.keyPattern);
  }

  if (error?.keyValue && typeof error.keyValue === 'object') {
    return Object.keys(error.keyValue);
  }

  const match = String(error?.message || '').match(/index:\s+([a-zA-Z0-9_]+)_1/);
  return match ? [match[1]] : [];
};

const isDuplicateKeyForField = (error, field) => (
  error?.code === 11000 && getDuplicateKeyFields(error).includes(field)
);

const createOrganizationWithSlugRetry = async ({ organizationName, organizationSlug, email }) => {
  let lastError = null;

  for (let attempt = 0; attempt < ORGANIZATION_REGISTRATION_SLUG_RETRY_LIMIT; attempt += 1) {
    try {
      return await Organization.create(
        await buildOrganizationRegistrationPayload({
          organizationName,
          organizationSlug,
          email
        })
      );
    } catch (error) {
      lastError = error;

      if (!isDuplicateKeyForField(error, 'slug') || attempt === ORGANIZATION_REGISTRATION_SLUG_RETRY_LIMIT - 1) {
        throw error;
      }
    }
  }

  throw lastError;
};

const getOrganizationRegistrationErrorMessage = (error) => {
  if (error?.name === 'ValidationError') {
    return Object.values(error.errors).map((entry) => entry.message).join(', ');
  }

  if (error?.code === 11000) {
    if (isDuplicateKeyForField(error, 'slug')) {
      return 'Organization slug already exists';
    }

    if (isDuplicateKeyForField(error, 'email')) {
      return 'Email already exists';
    }

    return 'Duplicate field value entered';
  }

  return error.message;
};

const findLoginUserWithoutOrganization = async (email, password) => {
  const users = await User.find({
    email: normalizeEmail(email)
  })
    .select('+password')
    .limit(20);

  if (users.length === 0) {
    return { user: null, organization: null, error: 'not_found' };
  }

  const matchedUsers = [];
  for (const candidateUser of users) {
    const isMatch = await candidateUser.comparePassword(password);
    if (isMatch) {
      matchedUsers.push(candidateUser);
    }
  }

  if (matchedUsers.length === 0) {
    return { user: null, organization: null, error: 'not_found' };
  }

  if (matchedUsers.length > 1) {
    return { user: null, organization: null, error: 'ambiguous' };
  }

  const user = matchedUsers[0];
  const organization = await resolveOrganizationForUser(user);
  if (!organization) {
    return { user: null, organization: null, error: 'organization_required' };
  }

  return { user, organization, error: null };
};

const resolvePasswordResetTargets = async (email, scopedOrganization = null) => {
  const normalizedEmail = normalizeEmail(email);
  const users = await User.find(
    scopedOrganization
      ? buildOrganizationScopedEmailQuery(normalizedEmail, scopedOrganization._id)
      : { email: normalizedEmail }
  ).select('+resetPasswordToken +resetPasswordExpire');

  if (users.length === 0) {
    return [];
  }

  if (scopedOrganization) {
    return users.map((user) => ({
      user,
      organization: scopedOrganization
    }));
  }

  const organizationIds = [...new Set(
    users
      .map((user) => user.organizationId ? String(user.organizationId) : null)
      .filter(Boolean)
  )];

  const organizations = organizationIds.length > 0
    ? await Organization.find({ _id: { $in: organizationIds } }).lean()
    : [];
  const organizationsById = new Map(
    organizations.map((organization) => [String(organization._id), organization])
  );

  const targets = [];
  for (const user of users) {
    const organization = user.organizationId
      ? organizationsById.get(String(user.organizationId)) || null
      : await resolveOrganizationForUser(user);

    if (!organization) {
      continue;
    }

    targets.push({ user, organization });
  }

  return targets;
};

const getActivePasswordResetTargets = (targets = []) => targets.filter(({ user, organization }) => (
  Boolean(user && organization)
  && user.isActive !== false
  && organization.status === 'active'
));

const getSelfServicePasswordResetTargets = (targets = []) => getActivePasswordResetTargets(targets)
  .filter(({ organization }) => organization.securitySettings?.passwordResetEnabled !== false);

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

const formatOrganization = async (organization, options = {}) => {
  if (!organization) {
    return null;
  }

  const formattedOrganization = await formatOrganizationForClient(organization, options);
  return {
    id: formattedOrganization.id,
    name: formattedOrganization.name,
    slug: formattedOrganization.slug,
    status: formattedOrganization.status,
    locale: formattedOrganization.locale,
    timezone: formattedOrganization.timezone,
    branding: formattedOrganization.branding || {},
    featureFlags: formattedOrganization.featureFlags || {},
    departments: getOrganizationDepartments(formattedOrganization),
    subscription: formattedOrganization.subscription
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

const buildAuthResponse = async (user, organization, tokens = {}) => ({
  success: true,
  data: {
    user: formatUser(user),
    organization: await formatOrganization(organization),
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
        organization: await formatOrganization(organization)
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

    await assertUserSeatAvailable(organization);

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

    res.status(201).json(await buildAuthResponse(user, organization, {
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

// @desc    Send organization registration email verification code
// @route   POST /api/auth/register-organization/send-verification-code
// @access  Public
exports.sendOrganizationRegistrationVerificationCode = async (req, res) => {
  try {
    const {
      email,
      organizationName,
      languagePreference
    } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email address'
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const preferredLanguage = languagePreference === 'ar' ? 'ar' : 'en';
    const verificationCode = generateOrganizationVerificationCode();

    await OrganizationRegistrationVerification.findOneAndUpdate(
      { email: normalizedEmail },
      {
        $set: {
          codeHash: hashTokenValue(verificationCode),
          expiresAt: buildOrganizationVerificationExpiryDate(),
          verifiedAt: null,
          consumedAt: null,
          languagePreference: preferredLanguage,
          lastSentAt: new Date()
        },
        $unset: {
          verificationTokenHash: 1
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true
      }
    );

    const emailResult = await sendEmailToUser(
      normalizedEmail,
      (language) => getOrganizationRegistrationVerificationEmail({
        code: verificationCode,
        organizationName: organizationName || (language === 'ar' ? 'مؤسستك' : 'your organization'),
        expiresIn: buildOrganizationVerificationExpiryLabel(language)
      }, language),
      preferredLanguage
    );

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Unable to send verification code right now'
      });
    }

    res.json({
      success: true,
      message: 'Verification code sent to your email'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Verify organization registration email code
// @route   POST /api/auth/register-organization/verify-email
// @access  Public
exports.verifyOrganizationRegistrationEmail = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and verification code'
      });
    }

    const verification = await OrganizationRegistrationVerification.findOne({
      email: normalizeEmail(email)
    }).select('+codeHash +verificationTokenHash');

    if (!verification || verification.consumedAt || verification.expiresAt <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    if (verification.codeHash !== hashTokenValue(code)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    verification.verifiedAt = new Date();
    verification.verificationTokenHash = hashTokenValue(verificationToken);
    await verification.save();

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        verificationToken
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Register a new organization with its first admin user
// @route   POST /api/auth/register-organization
// @access  Public
exports.registerOrganization = async (req, res) => {
  try {
    const {
      organizationName,
      organizationSlug,
      name,
      email,
      password,
      phone,
      emailVerificationToken,
      languagePreference
    } = req.body;

    if (!organizationName || !name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide organization name, admin name, email, and password'
      });
    }

    if (!emailVerificationToken) {
      return res.status(400).json({
        success: false,
        message: 'Please verify your email before registering the organization'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const emailVerification = await claimOrganizationRegistrationVerification(email, emailVerificationToken);
    if (!emailVerification) {
      return res.status(400).json({
        success: false,
        message: 'Please verify your email before registering the organization'
      });
    }

    let organization = null;
    let user = null;

    try {
      organization = await createOrganizationWithSlugRetry({
        organizationName,
        organizationSlug,
        email
      });

      user = await User.create({
        organizationId: organization._id,
        name,
        email,
        password,
        phone,
        role: 'organization_admin',
        department: 'management',
        departments: [],
        languagePreference: languagePreference || 'en',
        leaveBalance: organization.leaveSettings?.defaultAnnualBalance || 0
      });

      await Organization.updateOne(
        { _id: organization._id },
        { $set: { createdBy: user._id } }
      );

      organization.createdBy = user._id;

      const accessToken = generateAccessToken(user, organization);
      const refreshToken = generateRefreshToken(user, organization);

      await User.updateOne(
        { _id: user._id },
        { $set: { refreshToken } }
      );

      user.refreshToken = refreshToken;

      res.status(201).json(await buildAuthResponse(user, organization, {
        accessToken,
        refreshToken
      }));
    } catch (error) {
      if (emailVerification?._id) {
        await OrganizationRegistrationVerification.updateOne(
          { _id: emailVerification._id },
          {
            $set: {
              consumedAt: null
            }
          }
        );
      }

      if (user?._id) {
        await User.deleteOne({ _id: user._id });
      }

      if (organization?._id) {
        await Organization.deleteOne({ _id: organization._id });
      }

      throw error;
    }
  } catch (error) {
    const statusCode = error.code === 11000 || error.name === 'ValidationError' ? 400 : 500;

    res.status(statusCode).json({
      success: false,
      message: getOrganizationRegistrationErrorMessage(error)
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    let organization = req.organization || null;
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    let user = null;

    if (organization) {
      organization = getActiveOrganization(req, res);
      if (!organization) {
        return;
      }

      user = await User.findOne(
        buildOrganizationScopedLoginQuery(email, organization._id)
      ).select('+password');

      if (user) {
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
          user = null;
        }
      }
    } else {
      const loginLookup = await findLoginUserWithoutOrganization(email, password);
      if (loginLookup.error === 'ambiguous') {
        return res.status(409).json({
          success: false,
          message: 'Multiple organizations matched this account. Please provide an organization slug.'
        });
      }

      if (loginLookup.error === 'organization_required') {
        return res.status(400).json({
          success: false,
          message: 'Unable to resolve organization for this account'
        });
      }

      user = loginLookup.user;
      organization = loginLookup.organization;
    }

    if (organization?.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Organization is not active'
      });
    }

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

    await attachLegacyUserToOrganization(user, organization);

    const accessToken = generateAccessToken(user, organization);
    const refreshToken = generateRefreshToken(user, organization);

    await User.updateOne(
      { _id: user._id },
      { $set: { refreshToken } }
    );

    user.refreshToken = refreshToken;

    res.json(await buildAuthResponse(user, organization, {
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
          organization: await formatOrganization(organization)
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

    res.json(await buildAuthResponse(user || req.user, req.organization));
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

    res.json(await buildAuthResponse(user, req.organization));
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
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    let scopedOrganization = req.organization || null;
    if (scopedOrganization) {
      scopedOrganization = getActiveOrganization(req, res);
      if (!scopedOrganization) {
        return;
      }
    }

    const targets = await resolvePasswordResetTargets(email, scopedOrganization);
    const selfServiceTargets = getSelfServicePasswordResetTargets(targets);

    if (targets.length === 0) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent'
      });
    }

    if (selfServiceTargets.length === 0) {
      return res.json({
        success: true,
        requiresAdminReset: true,
        message: 'Self-service password reset is disabled for this account. Please request a password reset from an administrator.'
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    for (const { user } of selfServiceTargets) {
      const resetToken = generateResetToken();
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpire = Date.now() + 60 * 60 * 1000;
      await user.save();

      const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
      const userLanguage = user.languagePreference || 'ar';
      await sendEmailToUser(user.email, (language) => getPasswordResetEmail({
        resetLink: resetUrl,
        userName: user.name,
        expiresIn: '1 hour'
      }, language), userLanguage);
    }

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
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    let scopedOrganization = req.organization || null;
    if (scopedOrganization) {
      scopedOrganization = getActiveOrganization(req, res);
      if (!scopedOrganization) {
        return;
      }
    }

    const targets = getActivePasswordResetTargets(
      await resolvePasswordResetTargets(email, scopedOrganization)
    );

    if (targets.length === 0) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset request has been sent to administrators'
      });
    }

    const requestDate = new Date();

    for (const { user, organization } of targets) {
      user.passwordResetRequested = true;
      user.passwordResetRequestDate = requestDate;
      await user.save();

      await sendEmailToAdmins(
        (language) => getPasswordResetRequestEmail({
          userName: user.name,
          userEmail: user.email,
          department: user.department,
          requestDate
        }, language),
        user.department,
        organization._id
      );
    }

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
