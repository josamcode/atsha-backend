const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Organization = require('../models/Organization');
const User = require('../models/User');
const FormTemplate = require('../models/FormTemplate');
const FormInstance = require('../models/FormInstance');
const AttendanceLog = require('../models/AttendanceLog');
const AttendanceToken = require('../models/AttendanceToken');
const LeaveRequest = require('../models/LeaveRequest');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const UserMetadata = require('../models/UserMetadata');
const UserActivityLog = require('../models/UserActivityLog');
const { LEGACY_DEPARTMENTS, normalizeDomain } = require('../utils/tenantConstants');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isDryRun = process.argv.includes('--dry-run');

const getArgValue = (name) => {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : undefined;
};

const titleizeDepartment = (value) => value
  .split(/[-_]/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const buildDefaultDepartments = () => LEGACY_DEPARTMENTS.map((code, index) => ({
  code,
  name: {
    en: titleizeDepartment(code),
    ar: titleizeDepartment(code)
  },
  isActive: true,
  sortOrder: index,
  isDefault: code === 'other'
}));

const parseDomain = (value) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  try {
    return new URL(trimmed).host.toLowerCase();
  } catch (error) {
    return normalizeDomain(trimmed.replace(/\/+$/g, ''));
  }
};

const tenantModels = [
  { name: 'User', model: User },
  { name: 'FormTemplate', model: FormTemplate },
  { name: 'FormInstance', model: FormInstance },
  { name: 'AttendanceLog', model: AttendanceLog },
  { name: 'AttendanceToken', model: AttendanceToken },
  { name: 'LeaveRequest', model: LeaveRequest },
  { name: 'Notification', model: Notification },
  { name: 'Message', model: Message },
  { name: 'UserMetadata', model: UserMetadata },
  { name: 'UserActivityLog', model: UserActivityLog }
];

const missingOrganizationQuery = {
  $or: [
    { organizationId: { $exists: false } },
    { organizationId: null }
  ]
};

const run = async () => {
  await connectDB();

  const organizationName = getArgValue('name') || process.env.DEFAULT_ORGANIZATION_NAME || 'AraRM';
  const organizationSlug = getArgValue('slug') || process.env.DEFAULT_ORGANIZATION_SLUG || 'AraRM';
  const rawDomains = process.env.DEFAULT_ORGANIZATION_DOMAINS || process.env.FRONTEND_URL || '';
  const allowedDomains = [...new Set(rawDomains
    .split(',')
    .map(parseDomain)
    .filter(Boolean))];

  const organizationDefaults = {
    name: organizationName,
    slug: organizationSlug,
    allowedDomains,
    departments: buildDefaultDepartments(),
    branding: {
      displayName: organizationName,
      shortName: organizationName,
      emailFromName: organizationName
    }
  };

  let defaultOrganization = await Organization.findOne({ slug: organizationSlug });

  if (!defaultOrganization) {
    if (isDryRun) {
      console.log(`[dry-run] organization "${organizationSlug}" would be created`);
    } else {
      defaultOrganization = await Organization.create(organizationDefaults);
      console.log(`Created default organization "${organizationSlug}" (${defaultOrganization._id})`);
    }
  } else {
    console.log(`Using existing organization "${organizationSlug}" (${defaultOrganization._id})`);
  }

  for (const entry of tenantModels) {
    const missingCount = await entry.model.countDocuments(missingOrganizationQuery);

    if (isDryRun || !defaultOrganization) {
      console.log(`[dry-run] ${entry.name}: ${missingCount} documents missing organizationId`);
      continue;
    }

    const result = await entry.model.updateMany(
      missingOrganizationQuery,
      { $set: { organizationId: defaultOrganization._id } }
    );

    console.log(`${entry.name}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }
};

run()
  .catch((error) => {
    console.error('Default organization backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
