const getOrganizationId = (source) => {
  if (!source) {
    return null;
  }

  if (source.organization && source.organization._id) {
    return source.organization._id;
  }

  if (source.organizationId) {
    return source.organizationId;
  }

  if (source._id) {
    return source._id;
  }

  return null;
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

  return String(record.organizationId) === String(organizationId);
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
