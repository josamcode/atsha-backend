const {
  resolveOrganizationSubscription
} = require('./subscription');

const formatOrganizationForClient = async (organization, options = {}) => {
  const {
    includeUsage = false,
    summary = null
  } = options;

  if (!organization) {
    return null;
  }

  const source = organization.toObject ? organization.toObject() : { ...organization };
  const subscription = await resolveOrganizationSubscription(source, {
    includeUsage
  });

  return {
    ...source,
    id: source._id,
    subscription,
    ...(summary ? { summary } : {})
  };
};

module.exports = {
  formatOrganizationForClient
};
