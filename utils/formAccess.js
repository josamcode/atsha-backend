const Organization = require('../models/Organization');
const {
  DEPARTMENT_SENTINELS,
  FORM_VISIBILITY_ROLE_VALUES,
  normalizeDepartmentCode,
  normalizeRole,
  toLegacyRole
} = require('./tenantConstants');
const { isPlatformAdmin } = require('./organizationAccess');

const ALLOWED_TEMPLATE_ROLES = new Set(
  FORM_VISIBILITY_ROLE_VALUES.map((role) => normalizeRole(role))
);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getRequestedOrganizationId = (req) => (
  req.body.organizationId ||
  req.query.organizationId ||
  null
);

const resolveFormsOrganization = async (req, fallbackOrganizationId = null) => {
  const requestedOrganizationId = getRequestedOrganizationId(req) || fallbackOrganizationId || null;

  if (isPlatformAdmin(req.user)) {
    if (requestedOrganizationId) {
      const organization = await Organization.findById(requestedOrganizationId);

      if (!organization) {
        throw createHttpError(404, 'Organization not found');
      }

      return organization;
    }

    if (req.organization) {
      return req.organization;
    }

    throw createHttpError(400, 'Organization context is required');
  }

  if (!req.organization) {
    throw createHttpError(400, 'Organization context is required');
  }

  if (requestedOrganizationId && String(req.organization._id) !== String(requestedOrganizationId)) {
    throw createHttpError(403, 'You do not have access to this organization');
  }

  if (fallbackOrganizationId && String(req.organization._id) !== String(fallbackOrganizationId)) {
    throw createHttpError(403, 'Record does not belong to the active organization');
  }

  return req.organization;
};

const getActiveDepartmentCodes = (organization) => new Set(
  (organization?.departments || [])
    .filter((entry) => entry.isActive !== false)
    .map((entry) => entry.code)
    .filter(Boolean)
);

const normalizeDepartmentArray = (departments) => {
  if (!Array.isArray(departments)) {
    return [];
  }

  return [...new Set(
    departments
      .map((value) => normalizeDepartmentCode(value))
      .filter(Boolean)
  )];
};

const getUserManagedDepartments = (user) => {
  const normalizedRole = normalizeRole(user?.role);

  if (normalizedRole === 'platform_admin' || normalizedRole === 'organization_admin') {
    return null;
  }

  if (normalizedRole === 'supervisor') {
    const departments = normalizeDepartmentArray(user?.departments);

    if (departments.some((department) => DEPARTMENT_SENTINELS.includes(department))) {
      return null;
    }

    if (departments.length > 0) {
      return new Set(departments);
    }
  }

  const fallbackDepartment = normalizeDepartmentCode(user?.department);
  return fallbackDepartment ? new Set([fallbackDepartment]) : new Set();
};

const hasDepartmentAccess = (user, department) => {
  const normalizedDepartment = normalizeDepartmentCode(department);
  const managedDepartments = getUserManagedDepartments(user);

  if (!normalizedDepartment) {
    return false;
  }

  if (!managedDepartments) {
    return true;
  }

  return managedDepartments.has(normalizedDepartment);
};

const ensureDepartmentAccess = (user, department, errorMessage = 'You do not have access to this department') => {
  if (!hasDepartmentAccess(user, department)) {
    throw createHttpError(403, errorMessage);
  }
};

const getRoleVariants = (role) => {
  const normalized = normalizeRole(role);
  return [...new Set([normalized, toLegacyRole(normalized)])];
};

const roleListIncludes = (roles = [], role) => {
  if (normalizeRole(role) === 'platform_admin') {
    return true;
  }

  const normalizedRoles = new Set(
    (roles || []).map((entry) => normalizeRole(entry))
  );

  return normalizedRoles.has(normalizeRole(role));
};

const templateSupportsDepartment = (template, department) => {
  const normalizedDepartment = normalizeDepartmentCode(department);
  const templateDepartments = normalizeDepartmentArray(template?.departments);

  return (
    templateDepartments.length === 0 ||
    templateDepartments.includes('all') ||
    templateDepartments.includes(normalizedDepartment)
  );
};

const normalizeTemplateRoles = (roles, fallbackRoles = null) => {
  if (roles === undefined) {
    return fallbackRoles;
  }

  if (!Array.isArray(roles) || roles.length === 0) {
    throw createHttpError(400, 'Template role configuration must be a non-empty array');
  }

  const normalizedRoles = [...new Set(
    roles.map((value) => normalizeRole(value))
  )];

  for (const role of normalizedRoles) {
    if (!ALLOWED_TEMPLATE_ROLES.has(role)) {
      throw createHttpError(400, `Role "${role}" is not allowed for template visibility`);
    }
  }

  return normalizedRoles.map((role) => toLegacyRole(role));
};

const normalizeTemplateDepartments = (departments, organization, options = {}) => {
  const { fallbackDepartments = null, defaultAll = false } = options;

  if (departments === undefined) {
    return fallbackDepartments;
  }

  if (!Array.isArray(departments)) {
    throw createHttpError(400, 'Template departments must be an array');
  }

  if (departments.length === 0) {
    return defaultAll ? ['all'] : [];
  }

  const allowedDepartments = getActiveDepartmentCodes(organization);
  const normalizedDepartments = [...new Set(
    departments
      .map((value) => normalizeDepartmentCode(value))
      .filter(Boolean)
  )];

  if (normalizedDepartments.includes('all')) {
    return ['all'];
  }

  for (const department of normalizedDepartments) {
    if (!allowedDepartments.has(department)) {
      throw createHttpError(400, `Department "${department}" is not configured for this organization`);
    }
  }

  return normalizedDepartments;
};

module.exports = {
  createHttpError,
  ensureDepartmentAccess,
  getActiveDepartmentCodes,
  getRequestedOrganizationId,
  getRoleVariants,
  getUserManagedDepartments,
  hasDepartmentAccess,
  normalizeTemplateDepartments,
  normalizeTemplateRoles,
  resolveScopedOrganization: resolveFormsOrganization,
  getManagedDepartments: getUserManagedDepartments,
  resolveFormsOrganization,
  roleListIncludes,
  templateSupportsDepartment
};
