const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const {
  normalizeRole,
  roleMatches,
  toLegacyRole
} = require('../utils/tenantConstants');
const { resolveOrganizationId } = require('../utils/organizationId');
const { getSessionBlockCode, sendAuthError } = require('../utils/authErrors');

const getBearerToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }

  return null;
};

const buildProtectedUserQuery = (decoded) => ({
  _id: decoded.id,
  $or: [
    { organizationId: decoded.organizationId },
    { organizationId: { $exists: false } },
    { organizationId: null }
  ]
});

// The token's organization is authoritative; a stale slug header must not end a valid session.
exports.protect = async (req, res, next) => {
  const token = getBearerToken(req);

  if (!token) {
    return sendAuthError(res, 'NOT_AUTHENTICATED');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return sendAuthError(res, error.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
  }

  if (!decoded.organizationId) {
    return sendAuthError(res, 'TOKEN_INVALID');
  }

  try {
    const organization = await Organization.findById(resolveOrganizationId(decoded.organizationId)).lean();
    if (!organization) {
      return sendAuthError(res, 'SESSION_ORGANIZATION_NOT_FOUND');
    }

    const user = await User.findOne(buildProtectedUserQuery(decoded)).select('-password +passwordChangedAt');
    if (!user) {
      return sendAuthError(res, 'SESSION_USER_NOT_FOUND');
    }

    const blockCode = getSessionBlockCode({ decoded, user, organization });
    if (blockCode) {
      return sendAuthError(res, blockCode);
    }

    req.organization = organization;
    user.organizationRole = normalizeRole(user.role);
    user.legacyRole = toLegacyRole(user.role);
    req.user = user;
    req.auth = {
      organizationId: resolveOrganizationId(organization),
      role: user.organizationRole,
      legacyRole: user.legacyRole,
      tokenRole: decoded.role || null
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

// Role-based authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendAuthError(res, 'NOT_AUTHENTICATED');
    }

    if (!roleMatches(req.user.role, roles)) {
      return sendAuthError(res, 'FORBIDDEN');
    }

    next();
  };
};

// Check if user has access to specific department
exports.checkDepartmentAccess = (req, res, next) => {
  const { department } = req.params;
  const normalizedRole = normalizeRole(req.user.role);

  // Organization admins have access to all departments
  if (normalizedRole === 'organization_admin') {
    return next();
  }

  // Supervisor can only access their departments
  if (normalizedRole === 'supervisor') {
    if (!req.user.departments || !req.user.departments.includes(department)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this department'
      });
    }
  }

  // Employee can only access their own department
  if (normalizedRole === 'employee') {
    if (req.user.department !== department) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this department'
      });
    }
  }

  next();
};
