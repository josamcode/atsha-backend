const { normalizeRole } = require('./tenantConstants');
const { organizationIdsMatch } = require('./organizationId');

const AUTH_ERRORS = {
  NOT_AUTHENTICATED: { status: 401, message: 'Not authorized to access this route' },
  TOKEN_EXPIRED: { status: 401, message: 'Your session has expired. Please log in again.' },
  TOKEN_INVALID: { status: 401, message: 'Session is no longer valid. Please sign in again.' },
  REFRESH_TOKEN_INVALID: { status: 401, message: 'Your session has expired. Please log in again.' },
  SESSION_REVOKED: { status: 401, message: 'Session is no longer valid. Please sign in again.' },
  SESSION_ROLE_CHANGED: { status: 401, message: 'User role changed. Please sign in again.' },
  SESSION_USER_NOT_FOUND: { status: 401, message: 'This account no longer exists' },
  SESSION_ORGANIZATION_NOT_FOUND: { status: 401, message: 'Organization not found for this session' },
  PASSWORD_CHANGED: { status: 401, message: 'Your password was changed. Please sign in again.' },
  USER_NOT_IN_ORGANIZATION: { status: 401, message: 'User does not belong to the active organization' },
  INVALID_CREDENTIALS: { status: 401, message: 'Incorrect email or password' },
  ACCOUNT_DEACTIVATED: {
    status: 401,
    message: 'Your account has been deactivated. Please contact your organization administrator.'
  },
  ACCOUNT_NOT_IN_ORGANIZATION: { status: 403, message: 'This account does not belong to the selected organization' },
  ORGANIZATION_INACTIVE: {
    status: 403,
    message: 'This organization is currently inactive. Please contact the platform administrator.'
  },
  ORGANIZATION_SUSPENDED: {
    status: 403,
    message: 'This organization has been suspended. Please contact the platform administrator.'
  },
  ORGANIZATION_NOT_FOUND: { status: 404, message: 'Organization not found' },
  ORGANIZATION_UNRESOLVED: { status: 400, message: 'Unable to resolve organization for this account' },
  ORGANIZATION_CONTEXT_REQUIRED: { status: 400, message: 'Organization context is required' },
  ORGANIZATION_SELECTION_REQUIRED: {
    status: 409,
    message: 'This account belongs to more than one organization. Please choose one to continue.'
  },
  CURRENT_PASSWORD_INCORRECT: { status: 400, message: 'Current password is incorrect' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action' }
};

const sendAuthError = (res, code, extra = {}) => {
  const { status, message } = AUTH_ERRORS[code];
  return res.status(status).json({ success: false, code, message, ...extra });
};

const getOrganizationStatusErrorCode = (organization) => {
  if (!organization) {
    return 'ORGANIZATION_NOT_FOUND';
  }

  if (organization.status === 'active') {
    return null;
  }

  return organization.status === 'suspended' ? 'ORGANIZATION_SUSPENDED' : 'ORGANIZATION_INACTIVE';
};

const getSessionBlockCode = ({ decoded, user, organization }) => {
  const organizationCode = getOrganizationStatusErrorCode(organization);
  if (organizationCode) {
    return organizationCode;
  }

  if (user.organizationId && !organizationIdsMatch(user.organizationId, organization)) {
    return 'USER_NOT_IN_ORGANIZATION';
  }

  if (!user.isActive) {
    return 'ACCOUNT_DEACTIVATED';
  }

  if (decoded.role && normalizeRole(decoded.role) !== normalizeRole(user.role)) {
    return 'SESSION_ROLE_CHANGED';
  }

  const currentSessionVersion = organization.securitySettings?.sessionVersion || 1;
  if (decoded.sessionVersion && decoded.sessionVersion !== currentSessionVersion) {
    return 'SESSION_REVOKED';
  }

  if (user.passwordChangedAt && decoded.iat * 1000 < new Date(user.passwordChangedAt).getTime()) {
    return 'PASSWORD_CHANGED';
  }

  return null;
};

module.exports = {
  AUTH_ERRORS,
  getOrganizationStatusErrorCode,
  getSessionBlockCode,
  sendAuthError
};
