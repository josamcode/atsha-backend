const { organizationIdsMatch, resolveOrganizationId } = require('./organizationId');

const getOrganizationId = (source) => {
  if (!source) {
    return null;
  }

  const nestedOrganizationId = resolveOrganizationId(source.organization);
  if (nestedOrganizationId) {
    return nestedOrganizationId;
  }

  const directOrganizationId = resolveOrganizationId(source.organizationId);
  if (directOrganizationId) {
    return directOrganizationId;
  }

  const sourceId = resolveOrganizationId(source._id);
  if (sourceId) {
    return sourceId;
  }

  return resolveOrganizationId(source);
};

const buildTenantQuery = (req, query = {}) => {
  const organizationId = getOrganizationId(req);

  if (!organizationId) {
    return { ...query };
  }

  return {
    ...query,
    organizationId
  };
};

const attachOrganizationId = (payload = {}, source) => {
  const organizationId = getOrganizationId(source);

  if (!organizationId) {
    return { ...payload };
  }

  return {
    ...payload,
    organizationId
  };
};

const assertSameOrganization = (record, source) => {
  const organizationId = getOrganizationId(source);

  if (!record || !organizationId || !record.organizationId) {
    return false;
  }

  return organizationIdsMatch(record.organizationId, organizationId);
};

const requireSameOrganization = (record, source, errorMessage = 'Record does not belong to the active organization') => {
  if (!assertSameOrganization(record, source)) {
    const error = new Error(errorMessage);
    error.statusCode = 403;
    throw error;
  }

  return record;
};

module.exports = {
  assertSameOrganization,
  attachOrganizationId,
  buildTenantQuery,
  getOrganizationId,
  requireSameOrganization
};
