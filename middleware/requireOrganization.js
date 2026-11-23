const { sendAuthError } = require('../utils/authErrors');

const requireOrganization = (req, res, next) => {
  if (req.organization) {
    return next();
  }

  return sendAuthError(
    res,
    req.organizationResolution?.error === 'not_found'
      ? 'ORGANIZATION_NOT_FOUND'
      : 'ORGANIZATION_CONTEXT_REQUIRED'
  );
};

module.exports = requireOrganization;
