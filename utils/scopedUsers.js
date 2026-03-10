const User = require('../models/User');
const { normalizeDepartmentCode } = require('./tenantConstants');

const normalizeDepartments = (departments) => (
  [...new Set(
    (departments || [])
      .map((value) => normalizeDepartmentCode(value))
      .filter(Boolean)
  )]
);

const getOrganizationDepartmentUserIds = async (organizationId, departments = []) => {
  const normalizedDepartments = normalizeDepartments(departments);

  if (!organizationId || normalizedDepartments.length === 0) {
    return [];
  }

  const users = await User.find({
    organizationId,
    department: { $in: normalizedDepartments }
  })
    .select('_id')
    .lean();

  return users.map((user) => user._id);
};

const isOrganizationUserInDepartments = async (organizationId, userId, departments = []) => {
  const normalizedDepartments = normalizeDepartments(departments);

  if (!organizationId || !userId || normalizedDepartments.length === 0) {
    return false;
  }

  const user = await User.findOne({
    _id: userId,
    organizationId,
    department: { $in: normalizedDepartments }
  })
    .select('_id')
    .lean();

  return Boolean(user);
};

module.exports = {
  getOrganizationDepartmentUserIds,
  isOrganizationUserInDepartments
};
