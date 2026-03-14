const resolveOrganizationId = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    const nestedOrganizationId = resolveOrganizationId(value.organization);
    if (nestedOrganizationId) {
      return nestedOrganizationId;
    }

    const directOrganizationId = resolveOrganizationId(value.organizationId);
    if (directOrganizationId) {
      return directOrganizationId;
    }

    if (value._id) {
      return String(value._id);
    }

    if (value.id) {
      return String(value.id);
    }

    if (typeof value.toString === 'function') {
      const serialized = value.toString();
      if (serialized && serialized !== '[object Object]') {
        return serialized;
      }
    }

    return null;
  }

  return String(value);
};

const organizationIdsMatch = (left, right) => {
  const leftId = resolveOrganizationId(left);
  const rightId = resolveOrganizationId(right);

  return Boolean(leftId && rightId && leftId === rightId);
};

module.exports = {
  organizationIdsMatch,
  resolveOrganizationId
};
