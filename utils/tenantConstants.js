const LEGACY_DEPARTMENTS = [
  'kitchen',
  'counter',
  'cleaning',
  'management',
  'delivery',
  'other'
];

const DEPARTMENT_SENTINELS = ['all'];

const USER_ROLE_VALUES = [
  'platform_admin',
  'organization_admin',
  'admin',
  'supervisor',
  'employee',
  'qr_manager',
  'qr-manager'
];

const FORM_VISIBILITY_ROLE_VALUES = [
  'organization_admin',
  'admin',
  'supervisor',
  'employee'
];

const ORGANIZATION_STATUS_VALUES = ['active', 'inactive', 'suspended'];
const ORGANIZATION_PLAN_VALUES = ['standard', 'enterprise', 'internal'];

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const departmentCodePattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ROLE_ALIASES = {
  platform_admin: 'platform_admin',
  organization_admin: 'organization_admin',
  admin: 'organization_admin',
  supervisor: 'supervisor',
  employee: 'employee',
  qr_manager: 'qr_manager',
  'qr-manager': 'qr_manager'
};

const LEGACY_ROLE_ALIASES = {
  platform_admin: 'platform_admin',
  organization_admin: 'admin',
  admin: 'admin',
  supervisor: 'supervisor',
  employee: 'employee',
  qr_manager: 'qr-manager',
  'qr-manager': 'qr-manager'
};

const normalizeDepartmentCode = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase().replace(/\s+/g, '-');
};

const normalizeDomain = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
};

const isValidSlug = (value) => {
  if (typeof value !== 'string') {
    return false;
  }

  return slugPattern.test(value.trim().toLowerCase());
};

const isValidDepartmentCode = (value, options = {}) => {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = normalizeDepartmentCode(value);

  if (options.allowAll && DEPARTMENT_SENTINELS.includes(normalized)) {
    return true;
  }

  return departmentCodePattern.test(normalized);
};

const normalizeRole = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return ROLE_ALIASES[value] || value;
};

const toLegacyRole = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = normalizeRole(value);
  return LEGACY_ROLE_ALIASES[normalized] || LEGACY_ROLE_ALIASES[value] || value;
};

const roleMatches = (userRole, allowedRoles = []) => {
  const normalizedUserRole = normalizeRole(userRole);
  return allowedRoles
    .map((role) => normalizeRole(role))
    .includes(normalizedUserRole);
};

module.exports = {
  DEPARTMENT_SENTINELS,
  FORM_VISIBILITY_ROLE_VALUES,
  LEGACY_DEPARTMENTS,
  LEGACY_ROLE_ALIASES,
  ORGANIZATION_PLAN_VALUES,
  ORGANIZATION_STATUS_VALUES,
  ROLE_ALIASES,
  USER_ROLE_VALUES,
  isValidDepartmentCode,
  isValidSlug,
  normalizeDepartmentCode,
  normalizeDomain,
  normalizeRole,
  roleMatches,
  slugPattern,
  toLegacyRole
};
