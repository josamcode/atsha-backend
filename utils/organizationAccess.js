const Organization = require('../models/Organization');
const { normalizeRole } = require('./tenantConstants');
const { organizationIdsMatch, resolveOrganizationId } = require('./organizationId');

const isPlatformAdmin = (user) => normalizeRole(user?.role) === 'platform_admin';
const isOrganizationAdmin = (user) => normalizeRole(user?.role) === 'organization_admin';

const resolveManagedOrganization = async (req, organizationId) => {
  const resolvedOrganizationId = resolveOrganizationId(organizationId);
  const activeOrganizationId = resolveOrganizationId(req.organization);

  if (isPlatformAdmin(req.user)) {
    if (resolvedOrganizationId) {
      return Organization.findById(resolvedOrganizationId);
    }

    return activeOrganizationId ? Organization.findById(activeOrganizationId) : null;
  }

  if (isOrganizationAdmin(req.user) && activeOrganizationId) {
    return Organization.findById(activeOrganizationId);
  }

  return null;
};

const ensureOrganizationAccess = (req, organizationId) => {
  const resolvedOrganizationId = resolveOrganizationId(organizationId);

  if (!resolvedOrganizationId) {
    return false;
  }

  if (isPlatformAdmin(req.user)) {
    return true;
  }

  if (isOrganizationAdmin(req.user) && req.organization?._id) {
    return organizationIdsMatch(req.organization, resolvedOrganizationId);
  }

  return false;
};

module.exports = {
  ensureOrganizationAccess,
  isOrganizationAdmin,
  isPlatformAdmin,
  resolveManagedOrganization
};
