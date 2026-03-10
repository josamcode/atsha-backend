const Organization = require('../models/Organization');
const { normalizeRole } = require('./tenantConstants');

const isPlatformAdmin = (user) => normalizeRole(user?.role) === 'platform_admin';
const isOrganizationAdmin = (user) => normalizeRole(user?.role) === 'organization_admin';

const resolveManagedOrganization = async (req, organizationId) => {
  if (isPlatformAdmin(req.user)) {
    if (organizationId) {
      return Organization.findById(organizationId);
    }

    return req.organization ? Organization.findById(req.organization._id) : null;
  }

  if (isOrganizationAdmin(req.user) && req.organization?._id) {
    return Organization.findById(req.organization._id);
  }

  return null;
};

const ensureOrganizationAccess = (req, organizationId) => {
  if (!organizationId) {
    return false;
  }

  if (isPlatformAdmin(req.user)) {
    return true;
  }

  if (isOrganizationAdmin(req.user) && req.organization?._id) {
    return String(req.organization._id) === String(organizationId);
  }

  return false;
};

module.exports = {
  ensureOrganizationAccess,
  isOrganizationAdmin,
  isPlatformAdmin,
  resolveManagedOrganization
};
