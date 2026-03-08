const Organization = require('../models/Organization');
const { isValidSlug, normalizeDomain } = require('../utils/tenantConstants');

const parseHostname = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch (error) {
    const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//i, '');
    const host = withoutProtocol.split('/')[0];
    return normalizeDomain(host.replace(/:\d+$/, ''));
  }
};

const getHostCandidates = (req) => {
  const candidates = [
    req.headers.origin,
    req.headers.referer,
    req.headers['x-forwarded-host'],
    req.headers.host
  ]
    .map(parseHostname)
    .filter(Boolean);

  return [...new Set(candidates)];
};

const getSlugCandidates = (req) => {
  const rawCandidates = [
    req.headers['x-organization-slug'],
    req.query?.organizationSlug,
    req.query?.organization,
    req.body?.organizationSlug,
    req.body?.organization,
    req.params?.organizationSlug
  ];

  const candidates = rawCandidates
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().toLowerCase())
    .filter((value) => isValidSlug(value));

  return [...new Set(candidates)];
};

const findSingleActiveOrganization = async () => {
  const organizations = await Organization.find({ status: 'active' })
    .sort({ createdAt: 1 })
    .limit(2)
    .lean();

  return organizations.length === 1 ? organizations[0] : null;
};

const resolveOrganizationContext = async (req) => {
  if (req.organization) {
    return req.organization;
  }

  let organization = null;
  let resolution = null;

  const hostCandidates = getHostCandidates(req);
  for (const host of hostCandidates) {
    organization = await Organization.findOne({ allowedDomains: host }).lean();
    if (organization) {
      resolution = { source: 'domain', value: host };
      break;
    }
  }

  if (!organization) {
    const slugCandidates = getSlugCandidates(req);

    for (const slug of slugCandidates) {
      organization = await Organization.findOne({ slug }).lean();
      if (organization) {
        resolution = { source: 'slug', value: slug };
        break;
      }
    }

    if (!organization && slugCandidates.length > 0) {
      resolution = { source: 'slug', value: slugCandidates[0], error: 'not_found' };
    }
  }

  if (!organization && process.env.DEFAULT_ORGANIZATION_SLUG) {
    const slug = process.env.DEFAULT_ORGANIZATION_SLUG.trim().toLowerCase();
    organization = await Organization.findOne({ slug }).lean();
    if (organization) {
      resolution = { source: 'default_slug', value: slug };
    }
  }

  if (!organization) {
    organization = await findSingleActiveOrganization();
    if (organization) {
      resolution = { source: 'single_active_org', value: organization.slug };
    }
  }

  req.organization = organization || null;
  req.organizationResolution = resolution;

  return req.organization;
};

const resolveOrganization = async (req, res, next) => {
  try {
    await resolveOrganizationContext(req);
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveOrganization;
module.exports.resolveOrganizationContext = resolveOrganizationContext;
