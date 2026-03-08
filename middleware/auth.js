const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const resolveOrganization = require('./resolveOrganization');
const {
  normalizeRole,
  roleMatches,
  toLegacyRole
} = require('../utils/tenantConstants');

const { resolveOrganizationContext } = resolveOrganization;

const getBearerToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }

  return null;
};

const findOrganizationById = async (organizationId) => {
  if (!organizationId) {
    return null;
  }

  return Organization.findById(organizationId).lean();
};

const buildProtectedUserQuery = (decoded, req) => {
  const query = { _id: decoded.id };

  if (decoded.organizationId) {
    query.$or = [
      { organizationId: decoded.organizationId },
      { organizationId: { $exists: false } },
      { organizationId: null }
    ];
    return query;
  }

  if (req.organization?._id) {
    query.$or = [
      { organizationId: req.organization._id },
      { organizationId: { $exists: false } },
      { organizationId: null }
    ];
  }

  return query;
};

// Verify JWT token
exports.protect = async (req, res, next) => {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!req.organization) {
      await resolveOrganizationContext(req);
    }

    const tokenOrganization = await findOrganizationById(decoded.organizationId);
    if (decoded.organizationId && !tokenOrganization) {
      return res.status(401).json({
        success: false,
        message: 'Organization not found for this session'
      });
    }

    if (req.organization && tokenOrganization && String(req.organization._id) !== String(tokenOrganization._id)) {
      return res.status(401).json({
        success: false,
        message: 'Token organization does not match the active organization'
      });
    }

    const user = await User.findOne(buildProtectedUserQuery(decoded, req)).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!req.organization && user.organizationId) {
      req.organization = await findOrganizationById(user.organizationId);
    }

    if (!req.organization && tokenOrganization) {
      req.organization = tokenOrganization;
    }

    if (!req.organization) {
      return res.status(400).json({
        success: false,
        message: 'Organization context is required'
      });
    }

    if (user.organizationId && String(user.organizationId) !== String(req.organization._id)) {
      return res.status(401).json({
        success: false,
        message: 'User does not belong to the active organization'
      });
    }

    if (req.organization.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Organization is not active'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated'
      });
    }

    if (decoded.role && normalizeRole(decoded.role) !== normalizeRole(user.role)) {
      return res.status(401).json({
        success: false,
        message: 'User role changed. Please sign in again.'
      });
    }

    const currentSessionVersion = req.organization.securitySettings?.sessionVersion || 1;
    if (decoded.sessionVersion && decoded.sessionVersion !== currentSessionVersion) {
      return res.status(401).json({
        success: false,
        message: 'Session is no longer valid. Please sign in again.'
      });
    }

    user.organizationRole = normalizeRole(user.role);
    user.legacyRole = toLegacyRole(user.role);
    req.user = user;
    req.auth = {
      organizationId: req.organization._id,
      role: user.organizationRole,
      legacyRole: user.legacyRole,
      tokenRole: decoded.role || null
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
};

// Role-based authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    if (!roleMatches(req.user.role, roles)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
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
