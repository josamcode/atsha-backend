const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Organization = require('../models/Organization');
const OrganizationRegistrationVerification = require('../models/OrganizationRegistrationVerification');
const PlatformConfig = require('../models/PlatformConfig');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyAccessToken,
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
const { organizationIdsMatch, resolveOrganizationId } = require('../utils/organizationId');
const { assertUserSeatAvailable } = require('../utils/subscription');
const { DEFAULT_PLATFORM_PROFILE } = require('../utils/platformDefaults');
const {
  getOrganizationStatusErrorCode,
  getSessionBlockCode,
  sendAuthError
} = require('../utils/authErrors');

const ORGANIZATION_EMAIL_VERIFICATION_EXPIRY_MINUTES = 10;
const ORGANIZATION_EMAIL_VERIFICATION_CODE_LENGTH = 6;
const ORGANIZATION_REGISTRATION_SLUG_RETRY_LIMIT = 3;
const ORGANIZATION_EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;

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
    return Organization.findById(resolveOrganizationId(user.organizationId)).lean();
  }

  // Legacy accounts never pick their organization from client input.
  const defaultSlug = String(process.env.DEFAULT_ORGANIZATION_SLUG || '').trim().toLowerCase();
  if (defaultSlug) {
    return Organization.findOne({ slug: defaultSlug }).lean();
  }

  return findSingleActiveOrganization();
};

const getPlatformRegistrationProfile = async () => {
  const config = await PlatformConfig.findOne({ key: 'global' })
    .select('profile')
    .lean();

  return {
    ...DEFAULT_PLATFORM_PROFILE,
    ...(config?.profile || {})
  };
};

const buildOrganizationRegistrationPayload = async ({ organizationName, organizationSlug, email }) => {
  const platformProfile = await getPlatformRegistrationProfile();
  const defaultPlanCode = platformProfile.defaultOrganizationPlan || 'free';

  return {
    name: organizationName,
    slug: await resolveAvailableOrganizationSlug(organizationName, organizationSlug),
    status: 'active',
    plan: defaultPlanCode,
    subscription: {
      planCode: defaultPlanCode,
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
    locale: platformProfile.locale || 'en',
    timezone: platformProfile.timezone || 'Africa/Cairo',
    branding: {
      displayName: organizationName,
      shortName: organizationName,
      legalName: organizationName,
      supportEmail: normalizeEmail(email),
      emailFromName: organizationName
    }
  };
};

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

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const getOrganizationDisplayName = (organization) => (
  organization?.branding?.displayName || organization?.name || null
);

const getLoginBlockCode = ({ user, organization }) => {
  if (!organization) {
    return user.organizationId ? 'ORGANIZATION_NOT_FOUND' : 'ORGANIZATION_UNRESOLVED';
  }

  return getOrganizationStatusErrorCode(organization) || (user.isActive ? null : 'ACCOUNT_DEACTIVATED');
};

const findLoginMatches = async (email, password) => {
  const users = await User.find({ email: normalizeEmail(email) })
    .select('+password')
    .limit(20);

  if (users.length === 0) {
    // Keeps response time the same for unknown emails.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return [];
  }

  const matches = [];
  for (const user of users) {
    if (await user.comparePassword(password)) {
      matches.push({ user, organization: await resolveOrganizationForUser(user) });
    }
  }

  return matches;
};

// Organization state is only revealed after the password has been verified.
const selectLoginMatch = (matches, req) => {
  const resolution = req.organizationResolution;
  const isSlugScoped = resolution?.source === 'slug';

  if (isSlugScoped && resolution.error) {
    return { errorCode: 'ORGANIZATION_NOT_FOUND' };
  }

  const scopedMatches = isSlugScoped
    ? matches.filter(({ organization }) => organizationIdsMatch(organization, req.organization))
    : matches;

  if (scopedMatches.length === 0) {
    return { errorCode: 'ACCOUNT_NOT_IN_ORGANIZATION' };
  }

  const usableMatches = scopedMatches.filter((match) => !getLoginBlockCode(match));

  if (usableMatches.length === 1) {
    return { match: usableMatches[0] };
  }

  if (usableMatches.length > 1) {
    const domainMatch = resolution?.source === 'domain'
      ? usableMatches.find(({ organization }) => organizationIdsMatch(organization, req.organization))
      : null;

    if (domainMatch) {
      return { match: domainMatch };
    }

    return {
      errorCode: 'ORGANIZATION_SELECTION_REQUIRED',
      extra: {
        organizations: usableMatches.map(({ organization }) => ({
          slug: organization.slug,
          name: getOrganizationDisplayName(organization)
        }))
      }
    };
  }

  const [blockedMatch] = scopedMatches;
  return {
    errorCode: getLoginBlockCode(blockedMatch),
    extra: { organizationName: getOrganizationDisplayName(blockedMatch.organization) }
  };
};

const sendServerError = (res, error) => {
  if (error?.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors).map((entry) => entry.message).join(', ')
    });
  }

  if (error?.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate field value entered'
    });
  }

  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message
    });
  }

  console.error('Auth error:', error);
  return res.status(500).json({
    success: false,
    message: 'Server Error'
  });
};

const resolvePasswordResetTargets = async (email) => {
  const users = await User.find({ email: normalizeEmail(email) })
    .select('+resetPasswordToken +resetPasswordExpire');

  if (users.length === 0) {
    return [];
  }

  const organizationIds = [...new Set(
    users
      .map((user) => resolveOrganizationId(user.organizationId))
      .filter(Boolean)
  )];

  const organizations = organizationIds.length > 0
    ? await Organization.find({ _id: { $in: organizationIds } }).lean()
    : [];
  const organizationsById = new Map(
    organizations.map((organization) => [resolveOrganizationId(organization), organization])
  );

  const targets = [];
  for (const user of users) {
    const organization = user.organizationId
      ? organizationsById.get(resolveOrganizationId(user.organizationId)) || null
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
  canRecordAttendance: Boolean(user.canRecordAttendance),
  workDays: user.workDays || [],
  workSchedule: user.workSchedule || {}
});

const getActiveOrganization = (req, res) => {
  if (!req.organization) {
    sendAuthError(res, 'ORGANIZATION_CONTEXT_REQUIRED');
    return null;
  }

  const statusCode = getOrganizationStatusErrorCode(req.organization);
  if (statusCode) {
    sendAuthError(res, statusCode);
    return null;
  }

  return req.organization;
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
  try {
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
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Private (Organization Admin, Platform Admin)
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

    const requestedRole = normalizeRole(role || 'employee');
    if (requestedRole === 'platform_admin' && normalizeRole(req.user.role) !== 'platform_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only platform admins can assign the platform admin role'
      });
    }

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
      role: toLegacyRole(requestedRole),
      department: department || 'other',
      departments: departments || [],
      languagePreference: languagePreference || 'en'
    });

    res.status(201).json({
      success: true,
      data: { user: formatUser(user) }
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Send organization registration email verification code
// @route   POST /api/auth/register-organization/send-verification-code
// @access  Public
exports.sendOrganizationRegistrationVerificationCode = async (req, res) => {
  try {
    const platformProfile = await getPlatformRegistrationProfile();
    if (platformProfile.allowOrganizationRegistration === false) {
      return res.status(403).json({
        success: false,
        message: 'Organization registration is currently disabled'
      });
    }

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
          failedAttempts: 0,
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
        organizationName: organizationName || 'مؤسستك',
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
    sendServerError(res, error);
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

    if ((verification.failedAttempts || 0) >= ORGANIZATION_EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      return res.status(400).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new code.'
      });
    }

    if (verification.codeHash !== hashTokenValue(code)) {
      await OrganizationRegistrationVerification.updateOne(
        { _id: verification._id },
        { $inc: { failedAttempts: 1 } }
      );

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
    sendServerError(res, error);
  }
};

// @desc    Register a new organization with its first admin user
// @route   POST /api/auth/register-organization
// @access  Public
exports.registerOrganization = async (req, res) => {
  try {
    const platformProfile = await getPlatformRegistrationProfile();
    if (platformProfile.allowOrganizationRegistration === false) {
      return res.status(403).json({
        success: false,
        message: 'Organization registration is currently disabled'
      });
    }

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
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const matches = await findLoginMatches(email, password);
    if (matches.length === 0) {
      return sendAuthError(res, 'INVALID_CREDENTIALS');
    }

    const { match, errorCode, extra } = selectLoginMatch(matches, req);
    if (errorCode) {
      return sendAuthError(res, errorCode, extra);
    }

    const { user, organization } = match;

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
    sendServerError(res, error);
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return sendAuthError(res, 'REFRESH_TOKEN_INVALID');
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded?.organizationId) {
      return sendAuthError(res, 'REFRESH_TOKEN_INVALID');
    }

    const organization = await Organization.findById(decoded.organizationId).lean();
    if (!organization) {
      return sendAuthError(res, 'SESSION_ORGANIZATION_NOT_FOUND');
    }

    const user = await User.findOne(
      buildScopedUserQuery(decoded.id, organization._id)
    ).select('+refreshToken +passwordChangedAt');

    if (!user || user.refreshToken !== refreshToken) {
      return sendAuthError(res, 'REFRESH_TOKEN_INVALID');
    }

    const blockCode = getSessionBlockCode({ decoded, user, organization });
    if (blockCode) {
      return sendAuthError(res, blockCode);
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
    sendServerError(res, error);
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Public (identified by refresh or bearer token, so expired sessions can still log out)
exports.logout = async (req, res) => {
  try {
    const submittedRefreshToken = req.body?.refreshToken;
    const decodedRefresh = verifyRefreshToken(submittedRefreshToken);

    if (decodedRefresh) {
      await User.updateOne(
        { _id: decodedRefresh.id, refreshToken: submittedRefreshToken },
        { $set: { refreshToken: null } }
      );
    } else {
      const bearerToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const decodedAccess = bearerToken ? verifyAccessToken(bearerToken) : null;

      if (decodedAccess) {
        await User.updateOne({ _id: decodedAccess.id }, { $set: { refreshToken: null } });
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    sendServerError(res, error);
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
    sendServerError(res, error);
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
    sendServerError(res, error);
  }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
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
      return sendAuthError(res, 'CURRENT_PASSWORD_INCORRECT');
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // Other devices are signed out; this one continues with fresh tokens.
    const accessToken = generateAccessToken(user, req.organization);
    const refreshToken = generateRefreshToken(user, req.organization);
    await User.updateOne({ _id: user._id }, { $set: { refreshToken } });

    res.json({
      success: true,
      message: 'Password changed successfully',
      data: { accessToken, refreshToken }
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Forgot password (self-reset)
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    const targets = getActivePasswordResetTargets(await resolvePasswordResetTargets(email));
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
        expiresIn: 'ساعة واحدة'
      }, language), userLanguage);
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent'
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Reset password with token
// @route   POST /api/auth/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (typeof password !== 'string' || !password) {
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
    }).select('+resetPasswordToken +resetPasswordExpire +refreshToken');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    const organization = await resolveOrganizationForUser(user);
    const blockCode = getLoginBlockCode({ user, organization });
    if (blockCode) {
      return sendAuthError(res, blockCode, {
        organizationName: getOrganizationDisplayName(organization)
      });
    }

    user.password = password;
    user.refreshToken = undefined;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    user.passwordResetRequested = false;
    user.passwordResetRequestDate = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Request password reset from admin
// @route   POST /api/auth/request-password-reset
// @access  Public
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    const targets = getActivePasswordResetTargets(await resolvePasswordResetTargets(email));

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
    sendServerError(res, error);
  }
};
