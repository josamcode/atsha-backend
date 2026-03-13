const User = require('../models/User');
const UserMetadata = require('../models/UserMetadata');
const { createNotification } = require('../utils/notifications');
const {
  sendEmailToUser,
  getEmployeeReportEmail,
  getPasswordResetByAdminEmail
} = require('../utils/emailService');
const {
  getUsers: queryUsers,
  getUserById: queryUserById,
  getUserCount,
  searchUsers: querySearchUsers
} = require('../utils/userQueries');
const logger = require('../utils/logger');
const { deleteStoredAsset, uploadUserImage } = require('../utils/mediaStorage');
const { createAuditLog } = require('../utils/auditLogger');
const {
  isPlatformAdmin,
  resolveManagedOrganization
} = require('../utils/organizationAccess');
const {
  attachOrganizationId,
  buildTenantQuery,
  assertSameOrganization
} = require('../utils/tenantScope');
const {
  DEPARTMENT_SENTINELS,
  LEGACY_DEPARTMENTS,
  normalizeDepartmentCode,
  normalizeRole,
  toLegacyRole
} = require('../utils/tenantConstants');
const { assertUserSeatAvailable } = require('../utils/subscription');

const MANAGED_ROLE_VALUES = new Set([
  'platform_admin',
  'organization_admin',
  'supervisor',
  'employee',
  'qr_manager'
]);

const ALLOWED_SORT_FIELDS = new Set([
  'name',
  'email',
  'department',
  'role',
  'isActive',
  'createdAt',
  'updatedAt'
]);

const ROLE_LABELS = {
  platform_admin: { en: 'Platform Admin', ar: 'Platform Admin' },
  organization_admin: { en: 'Organization Admin', ar: 'Organization Admin' },
  supervisor: { en: 'Supervisor', ar: 'Supervisor' },
  employee: { en: 'Employee', ar: 'Employee' },
  qr_manager: { en: 'QR Manager', ar: 'QR Manager' }
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_NAMES_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sendControllerError = (res, error) => {
  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate field value entered'
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors).map((entry) => entry.message).join(', ')
    });
  }

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message
  });
};

const titleizeDepartment = (value = 'other') => value
  .split(/[-_]/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const getOrganizationDepartmentEntries = (organization) => {
  const departments = Array.isArray(organization?.departments)
    ? organization.departments.filter((entry) => entry?.code)
    : [];

  if (departments.length > 0) {
    return departments;
  }

  return LEGACY_DEPARTMENTS.map((code, index) => ({
    code,
    name: {
      en: titleizeDepartment(code),
      ar: titleizeDepartment(code)
    },
    isActive: true,
    sortOrder: index,
    isDefault: code === 'other'
  }));
};

const normalizeTextValue = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
};

const normalizeEmailValue = (value) => {
  const normalized = normalizeTextValue(value);
  return typeof normalized === 'string' ? normalized.toLowerCase() : normalized;
};

const formatUser = (user) => {
  if (!user) {
    return null;
  }

  const source = user.toObject ? user.toObject() : { ...user };

  delete source.password;
  delete source.refreshToken;
  delete source.resetPasswordToken;
  delete source.resetPasswordExpire;

  return {
    ...source,
    id: source._id,
    role: toLegacyRole(source.role),
    organizationRole: normalizeRole(source.role)
  };
};

const getRequestedOrganizationId = (req) => (
  req.body.organizationId ||
  req.query.organizationId ||
  null
);

const resolveUserManagementOrganization = async (req) => {
  const requestedOrganizationId = getRequestedOrganizationId(req);

  if (isPlatformAdmin(req.user)) {
    const organization = await resolveManagedOrganization(req, requestedOrganizationId);

    if (!organization) {
      throw createHttpError(
        requestedOrganizationId ? 404 : 400,
        requestedOrganizationId ? 'Organization not found' : 'Organization context is required'
      );
    }

    return organization;
  }

  if (requestedOrganizationId && (!req.organization || String(req.organization._id) !== String(requestedOrganizationId))) {
    throw createHttpError(403, 'You do not have access to this organization');
  }

  if (!req.organization) {
    throw createHttpError(400, 'Organization context is required');
  }

  return req.organization;
};

const getActiveDepartmentCodes = (organization) => new Set(
  getOrganizationDepartmentEntries(organization)
    .filter((entry) => entry.isActive !== false)
    .map((entry) => entry.code)
    .filter(Boolean)
);

const normalizeDepartmentArray = (departments) => {
  if (!Array.isArray(departments)) {
    return [];
  }

  return [...new Set(
    departments
      .map((value) => normalizeDepartmentCode(value))
      .filter(Boolean)
  )];
};

const getManagedDepartments = (user) => {
  const departments = normalizeDepartmentArray(user?.departments);

  if (departments.some((department) => DEPARTMENT_SENTINELS.includes(department))) {
    return null;
  }

  if (departments.length > 0) {
    return new Set(departments);
  }

  const fallbackDepartment = normalizeDepartmentCode(user?.department);
  return fallbackDepartment ? new Set([fallbackDepartment]) : new Set();
};

const hasDepartmentAccess = (user, department) => {
  const normalizedDepartment = normalizeDepartmentCode(department);
  const managedDepartments = getManagedDepartments(user);

  if (!managedDepartments) {
    return true;
  }

  return managedDepartments.has(normalizedDepartment);
};

const buildRoleFilter = (role) => {
  const normalizedRole = normalizeRole(role);
  const variants = [...new Set([normalizedRole, toLegacyRole(normalizedRole)])];

  return variants.length === 1 ? variants[0] : { $in: variants };
};

const resolveRoleAssignment = (inputRole, actor) => {
  const organizationRole = normalizeRole(inputRole || 'employee');

  if (!MANAGED_ROLE_VALUES.has(organizationRole)) {
    throw createHttpError(400, 'Invalid user role');
  }

  if (!isPlatformAdmin(actor) && organizationRole === 'platform_admin') {
    throw createHttpError(403, 'Only platform admins can assign the platform admin role');
  }

  return {
    organizationRole,
    storedRole: toLegacyRole(organizationRole)
  };
};

const resolveDepartmentAssignments = ({ organization, body, existingUser = null, organizationRole }) => {
  const allowedDepartments = getActiveDepartmentCodes(organization);
  const fallbackDepartment = normalizeDepartmentCode(existingUser?.department || 'other') || 'other';

  let department = body.department !== undefined
    ? normalizeDepartmentCode(body.department)
    : fallbackDepartment;

  if (!department) {
    department = allowedDepartments.has('other')
      ? 'other'
      : Array.from(allowedDepartments)[0];
  }

  if (!department || !allowedDepartments.has(department)) {
    throw createHttpError(400, `Department "${department}" is not configured for this organization`);
  }

  let departments;
  if (body.departments === undefined) {
    departments = normalizeDepartmentArray(existingUser?.departments);
  } else if (body.departments === null) {
    departments = [];
  } else if (Array.isArray(body.departments)) {
    departments = normalizeDepartmentArray(body.departments);
  } else {
    throw createHttpError(400, 'Departments must be an array');
  }

  if (departments.some((value) => DEPARTMENT_SENTINELS.includes(value))) {
    departments = Array.from(allowedDepartments);
  }

  for (const value of departments) {
    if (!allowedDepartments.has(value)) {
      throw createHttpError(400, `Department "${value}" is not configured for this organization`);
    }
  }

  if (organizationRole === 'supervisor' && departments.length === 0) {
    departments = [department];
  }

  if (organizationRole !== 'supervisor') {
    departments = [];
  }

  return {
    department,
    departments: [...new Set(departments)]
  };
};

const parseWorkSchedule = (workSchedule, contextLabel) => {
  if (workSchedule === undefined || workSchedule === null) {
    return {};
  }

  try {
    let normalizedSchedule = {};

    if (typeof workSchedule === 'string' && workSchedule.trim()) {
      normalizedSchedule = JSON.parse(workSchedule);
    } else if (Array.isArray(workSchedule)) {
      logger.warn(`Invalid workSchedule format (array) for ${contextLabel}, using empty object`);
      normalizedSchedule = {};
    } else if (typeof workSchedule === 'object') {
      normalizedSchedule = workSchedule;
    }

    if (normalizedSchedule instanceof Map) {
      normalizedSchedule = Object.fromEntries(normalizedSchedule);
    }

    const scheduleSize = JSON.stringify(normalizedSchedule).length;
    if (scheduleSize > 10000) {
      logger.warn(`workSchedule too large (${scheduleSize} bytes) for ${contextLabel}, truncating`);
      return {};
    }

    return normalizedSchedule;
  } catch (error) {
    logger.warn(`Error parsing workSchedule for ${contextLabel}: ${error.message}, using empty object`);
    return {};
  }
};

const parsePagination = (page, limit) => {
  const normalizedPage = Math.max(parseInt(page, 10) || 1, 1);
  const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit
  };
};

const parseSort = (sort = 'name') => {
  const sortValue = typeof sort === 'string' && sort.trim() ? sort.trim() : 'name';
  const descending = sortValue.startsWith('-');
  const field = descending ? sortValue.slice(1) : sortValue;
  const normalizedField = ALLOWED_SORT_FIELDS.has(field) ? field : 'name';

  return {
    [normalizedField]: descending ? -1 : 1
  };
};

const ensureUserAccess = (req, user, organization) => {
  const requesterRole = normalizeRole(req.user?.role);
  const targetRole = normalizeRole(user?.role);

  if (isPlatformAdmin(req.user)) {
    if (organization && user.organizationId && String(user.organizationId) !== String(organization._id)) {
      throw createHttpError(403, 'User does not belong to the selected organization');
    }

    return;
  }

  if (!assertSameOrganization(user, req)) {
    throw createHttpError(403, 'You do not have access to this user');
  }

  if (targetRole === 'platform_admin') {
    throw createHttpError(403, 'You do not have access to this user');
  }

  if (requesterRole === 'organization_admin') {
    return;
  }

  if (requesterRole === 'supervisor') {
    if (String(req.user._id) === String(user._id)) {
      return;
    }

    if (!hasDepartmentAccess(req.user, user.department)) {
      throw createHttpError(403, 'You do not have access to this user');
    }

    return;
  }

  if (String(req.user._id) !== String(user._id)) {
    throw createHttpError(403, 'You do not have access to this user');
  }
};

const getDepartmentDisplayName = (organization, departmentCode, language = 'en') => {
  const normalizedCode = normalizeDepartmentCode(departmentCode) || 'other';
  const department = getOrganizationDepartmentEntries(organization)
    .find((entry) => entry.code === normalizedCode);

  if (department?.name?.[language]) {
    return department.name[language];
  }

  if (department?.name?.en) {
    return department.name.en;
  }

  return titleizeDepartment(normalizedCode);
};

const getRoleLabel = (role, language = 'en') => {
  const organizationRole = normalizeRole(role);
  const labels = ROLE_LABELS[organizationRole] || {
    en: organizationRole,
    ar: organizationRole
  };

  return labels[language] || labels.en;
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Platform Admin, Organization Admin, Supervisor)
exports.getUsers = async (req, res) => {
  try {
    const organization = await resolveUserManagementOrganization(req);
    const { role, department, isActive, search, page = 1, limit = 50, sort = 'name' } = req.query;
    const pagination = parsePagination(page, limit);
    const sortObject = parseSort(sort);
    const query = buildTenantQuery(organization);
    const requesterRole = normalizeRole(req.user.role);

    if (role) {
      query.role = buildRoleFilter(role);
    }

    if (department) {
      query.department = normalizeDepartmentCode(department);
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (requesterRole === 'supervisor') {
      if (query.department && !hasDepartmentAccess(req.user, query.department)) {
        throw createHttpError(403, 'You do not have access to this department');
      }

      const managedDepartments = getManagedDepartments(req.user);
      if (managedDepartments) {
        query.department = query.department || { $in: Array.from(managedDepartments) };
      }
    }

    const totalQuery = search
      ? {
        ...query,
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      }
      : query;

    const [users, total] = search
      ? await Promise.all([
        querySearchUsers(search, query, 'LIST', {
          limit: pagination.limit,
          skip: pagination.skip,
          sort: sortObject
        }),
        getUserCount(totalQuery)
      ])
      : await Promise.all([
        queryUsers(query, 'LIST', {
          sort: sortObject,
          limit: pagination.limit,
          skip: pagination.skip
        }),
        getUserCount(query)
      ]);

    res.json({
      success: true,
      count: users.length,
      total,
      data: users.map((user) => formatUser(user)),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        pages: Math.ceil(total / pagination.limit)
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private
exports.getUser = async (req, res) => {
  try {
    const organization = await resolveUserManagementOrganization(req);
    const user = await queryUserById(req.params.id, 'FULL');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    ensureUserAccess(req, user, organization);

    const includeMetadata = req.query.includeMetadata === 'true';
    let metadata = null;

    if (includeMetadata) {
      metadata = await UserMetadata.findOne(
        buildTenantQuery(user, { userId: user._id })
      ).lean();
    }

    res.json({
      success: true,
      data: formatUser(user),
      ...(includeMetadata ? { metadata: metadata || null } : {})
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Create user
// @route   POST /api/users
// @access  Private (Platform Admin, Organization Admin)
exports.createUser = async (req, res) => {
  let uploadedImageUrl = null;
  let createdUser = null;

  try {
    const organization = await resolveUserManagementOrganization(req);
    const {
      name,
      email,
      password,
      phone,
      role,
      languagePreference,
      leaveBalance,
      workDays,
      workSchedule,
      nationality,
      idNumber,
      jobTitle
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password'
      });
    }

    const normalizedEmail = normalizeEmailValue(email);
    const roleAssignment = resolveRoleAssignment(role, req.user);
    const departmentAssignment = resolveDepartmentAssignments({
      organization,
      body: req.body,
      organizationRole: roleAssignment.organizationRole
    });

    const existingUser = await User.findOne(
      buildTenantQuery(organization, { email: normalizedEmail })
    ).lean();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email in this organization'
      });
    }

    await assertUserSeatAvailable(organization);

    if (req.file) {
      const uploadedImage = await uploadUserImage(req.file);
      uploadedImageUrl = uploadedImage.secure_url;
    }

    createdUser = await User.create(attachOrganizationId({
      name: normalizeTextValue(name),
      email: normalizedEmail,
      password,
      phone: phone || undefined,
      role: roleAssignment.storedRole,
      department: departmentAssignment.department,
      departments: departmentAssignment.departments,
      languagePreference: languagePreference || 'en',
      leaveBalance: leaveBalance || 0,
      workDays: Array.isArray(workDays) ? workDays : [],
      workSchedule: parseWorkSchedule(workSchedule, `user creation for ${normalizedEmail}`),
      nationality: nationality || undefined,
      idNumber: idNumber || undefined,
      jobTitle: jobTitle || undefined,
      image: uploadedImageUrl || undefined
    }, organization));

    await createNotification({
      organizationId: organization._id,
      type: 'user_created',
      title: {
        en: 'New User Created',
        ar: 'تم إنشاء مستخدم جديد'
      },
      message: {
        en: `New user "${createdUser.name}" has been created with role: ${getRoleLabel(roleAssignment.organizationRole, 'en')}`,
        ar: `تم إنشاء مستخدم جديد "${createdUser.name}" بدور: ${getRoleLabel(roleAssignment.organizationRole, 'ar')}`
      },
      data: {
        userId: createdUser._id,
        name: createdUser.name,
        email: createdUser.email,
        role: roleAssignment.storedRole,
        organizationRole: roleAssignment.organizationRole,
        department: createdUser.department
      }
    });

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'user.created',
      entityType: 'user',
      entityId: createdUser._id,
      metadata: {
        email: createdUser.email,
        role: roleAssignment.organizationRole,
        department: createdUser.department
      }
    });

    res.status(201).json({
      success: true,
      data: formatUser(createdUser)
    });
  } catch (error) {
    if (!createdUser && uploadedImageUrl) {
      try {
        await deleteStoredAsset(uploadedImageUrl);
      } catch (cleanupError) {
        console.error('Error deleting uploaded user image after failure:', cleanupError);
      }
    }

    sendControllerError(res, error);
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Platform Admin, Organization Admin)
exports.updateUser = async (req, res) => {
  let newImageUrl = null;
  let updateCompleted = false;

  try {
    const organization = await resolveUserManagementOrganization(req);
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    ensureUserAccess(req, user, organization);

    const isSelf = String(user._id) === String(req.user._id);
    if (isSelf && req.body.isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    if (isSelf && req.body.role && normalizeRole(req.body.role) !== normalizeRole(user.role)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role'
      });
    }

    const nextRoleAssignment = req.body.role
      ? resolveRoleAssignment(req.body.role, req.user)
      : {
        organizationRole: normalizeRole(user.role),
        storedRole: user.role
      };

    const departmentAssignment = (
      req.body.department !== undefined ||
      req.body.departments !== undefined ||
      req.body.role !== undefined
    )
      ? resolveDepartmentAssignments({
        organization,
        body: req.body,
        existingUser: user,
        organizationRole: nextRoleAssignment.organizationRole
      })
      : {
        department: user.department,
        departments: user.departments || []
      };

    const updateFields = {};
    if (req.body.name !== undefined) updateFields.name = normalizeTextValue(req.body.name);
    if (req.body.email !== undefined) updateFields.email = normalizeEmailValue(req.body.email);
    if (req.body.phone !== undefined) updateFields.phone = req.body.phone;
    if (req.body.role !== undefined) updateFields.role = nextRoleAssignment.storedRole;
    if (req.body.languagePreference !== undefined) updateFields.languagePreference = req.body.languagePreference;
    if (req.body.isActive !== undefined) updateFields.isActive = req.body.isActive;
    if (req.body.leaveBalance !== undefined) updateFields.leaveBalance = req.body.leaveBalance;
    if (req.body.workDays !== undefined) updateFields.workDays = Array.isArray(req.body.workDays) ? req.body.workDays : [];
    if (req.body.workSchedule !== undefined) {
      updateFields.workSchedule = parseWorkSchedule(req.body.workSchedule, `user ${req.params.id}`);
    }
    if (req.body.nationality !== undefined) updateFields.nationality = req.body.nationality;
    if (req.body.idNumber !== undefined) updateFields.idNumber = req.body.idNumber;
    if (req.body.jobTitle !== undefined) updateFields.jobTitle = req.body.jobTitle;

    if (
      req.body.department !== undefined ||
      req.body.departments !== undefined ||
      req.body.role !== undefined
    ) {
      updateFields.department = departmentAssignment.department;
      updateFields.departments = departmentAssignment.departments;
    }

    if (req.file) {
      const uploadedImage = await uploadUserImage(req.file);
      newImageUrl = uploadedImage.secure_url;
      updateFields.image = newImageUrl;
    }

    const refreshTokenShouldBeCleared = (
      (req.body.role !== undefined && normalizeRole(user.role) !== nextRoleAssignment.organizationRole) ||
      (req.body.isActive !== undefined && req.body.isActive !== user.isActive)
    );

    const updateDocument = { $set: updateFields };
    if (refreshTokenShouldBeCleared) {
      updateDocument.$unset = { refreshToken: 1 };
    }

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      updateDocument,
      { new: true, runValidators: true }
    ).select('-password -refreshToken');
    updateCompleted = true;

    if (newImageUrl && user.image && user.image !== newImageUrl) {
      try {
        await deleteStoredAsset(user.image);
      } catch (cleanupError) {
        console.error('Error deleting old user image:', cleanupError);
      }
    }

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'user.updated',
      entityType: 'user',
      entityId: updatedUser._id,
      metadata: {
        email: updatedUser.email,
        role: normalizeRole(updatedUser.role),
        department: updatedUser.department,
        changedFields: Object.keys(updateFields)
      }
    });

    if (req.body.role !== undefined && normalizeRole(user.role) !== nextRoleAssignment.organizationRole) {
      await createAuditLog({
        req,
        organizationId: organization._id,
        actorUserId: req.user._id,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: updatedUser._id,
        metadata: {
          previousRole: normalizeRole(user.role),
          nextRole: nextRoleAssignment.organizationRole
        }
      });
    }

    res.json({
      success: true,
      data: formatUser(updatedUser)
    });
  } catch (error) {
    if (!updateCompleted && newImageUrl) {
      try {
        await deleteStoredAsset(newImageUrl);
      } catch (cleanupError) {
        console.error('Error deleting newly uploaded user image after failure:', cleanupError);
      }
    }

    sendControllerError(res, error);
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Platform Admin, Organization Admin)
exports.deleteUser = async (req, res) => {
  try {
    const organization = await resolveUserManagementOrganization(req);
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    ensureUserAccess(req, user, organization);

    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    await Promise.all([
      user.deleteOne(),
      UserMetadata.deleteOne(buildTenantQuery(user, { userId: user._id }))
    ]);

    if (user.image) {
      try {
        await deleteStoredAsset(user.image);
      } catch (cleanupError) {
        console.error('Error deleting user image after delete:', cleanupError);
      }
    }

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'user.deleted',
      entityType: 'user',
      entityId: user._id,
      metadata: {
        email: user.email,
        role: normalizeRole(user.role),
        department: user.department
      }
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Reset user password
// @route   PUT /api/users/:id/reset-password
// @access  Private (Platform Admin, Organization Admin)
exports.resetPassword = async (req, res) => {
  try {
    const organization = await resolveUserManagementOrganization(req);
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide new password'
      });
    }

    const user = await User.findById(req.params.id)
      .select('+refreshToken +resetPasswordToken +resetPasswordExpire');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    ensureUserAccess(req, user, organization);

    user.password = newPassword;
    user.refreshToken = undefined;
    user.passwordResetRequested = false;
    user.passwordResetRequestDate = undefined;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    const userLanguage = user.languagePreference || 'ar';
    await sendEmailToUser(
      user.email,
      (language) => getPasswordResetByAdminEmail({
        userName: user.name,
        newPassword,
        resetBy: req.user.name
      }, language),
      userLanguage
    );

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'user.password_reset_by_admin',
      entityType: 'user',
      entityId: user._id,
      metadata: {
        email: user.email
      }
    });

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get password reset requests
// @route   GET /api/users/password-reset-requests
// @access  Private (Platform Admin, Organization Admin)
exports.getPasswordResetRequests = async (req, res) => {
  try {
    const organization = await resolveUserManagementOrganization(req);
    const users = await User.find(
      buildTenantQuery(organization, { passwordResetRequested: true })
    )
      .select('name email department passwordResetRequestDate _id role organizationId')
      .sort('-passwordResetRequestDate')
      .lean();

    res.json({
      success: true,
      count: users.length,
      data: users.map((user) => formatUser(user))
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get admin user (for employees to send messages)
// @route   GET /api/users/admin
// @access  Private
exports.getAdminUser = async (req, res) => {
  try {
    const organization = await resolveUserManagementOrganization(req);
    const admin = await User.findOne(
      buildTenantQuery(organization, {
        role: buildRoleFilter('organization_admin'),
        isActive: true
      })
    )
      .select('_id organizationId name email department departments role')
      .sort({ createdAt: 1 })
      .lean();

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    res.json({
      success: true,
      data: formatUser(admin)
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Send employee report via email
// @route   POST /api/users/:id/send-report
// @access  Private (Platform Admin, Organization Admin)
exports.sendEmployeeReport = async (req, res) => {
  try {
    const organization = await resolveUserManagementOrganization(req);
    const { month, year } = req.body;
    const employee = await User.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    ensureUserAccess(req, employee, organization);

    if (!employee.email) {
      return res.status(400).json({
        success: false,
        message: 'Employee email not found'
      });
    }

    const selectedMonth = month !== undefined ? parseInt(month, 10) : new Date().getMonth();
    const selectedYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const organizationQuery = organization.slug ? `&organization=${organization.slug}` : '';
    const reportUrl = `${frontendUrl}/users/${employee._id}/report?month=${selectedMonth}&year=${selectedYear}${organizationQuery}`;
    const language = employee.languagePreference || 'ar';
    const organizationName = organization.branding?.displayName || organization.name || 'Organization';

    const emailData = getEmployeeReportEmail({
      employeeName: employee.name,
      month: language === 'ar' ? MONTH_NAMES_AR[selectedMonth] : MONTH_NAMES[selectedMonth],
      year: selectedYear,
      department: getDepartmentDisplayName(organization, employee.department, language),
      reportUrl
    }, language);

    const emailContent = emailData.html.replace(
      /<p style="text-align: [^"]+; font-size: 12px; color: #6b7280;">[^<]+<\/p>/,
      `<div style="text-align: center; margin: 30px 0;">
        <a href="${reportUrl}" style="display: inline-block; padding: 12px 25px; background-color: #d4b900; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold;">${language === 'ar' ? 'عرض التقرير' : 'View Report'}</a>
      </div>
      <p style="text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 12px; color: #6b7280;">${organizationName} ${language === 'ar' ? 'فريق الإدارة' : 'Management Team'}</p>`
    );

    const result = await sendEmailToUser(
      employee.email,
      () => ({
        subject: emailData.subject,
        html: emailContent
      }),
      language
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to send report email'
      });
    }

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'user.report_sent',
      entityType: 'user',
      entityId: employee._id,
      metadata: {
        email: employee.email,
        month: selectedMonth,
        year: selectedYear
      }
    });

    res.json({
      success: true,
      message: 'Report sent successfully',
      data: {
        email: employee.email,
        messageId: result.messageId
      }
    });
  } catch (error) {
    console.error('Error sending employee report:', error);
    sendControllerError(res, error);
  }
};
