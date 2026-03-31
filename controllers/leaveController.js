const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const { createNotification } = require('../utils/notifications');
const {
  sendEmailToAdmins,
  sendEmailToUser,
  getLeaveRequestedEmail,
  getLeaveApprovedEmail,
  getLeaveRejectedEmail
} = require('../utils/emailService');
const { createAuditLog } = require('../utils/auditLogger');
const { attachOrganizationId, buildTenantQuery } = require('../utils/tenantScope');
const {
  createHttpError,
  ensureDepartmentAccess,
  getManagedDepartments,
  resolveScopedOrganization
} = require('../utils/formAccess');
const {
  normalizeDepartmentCode,
  normalizeRole
} = require('../utils/tenantConstants');
const {
  getOrganizationDepartmentUserIds
} = require('../utils/scopedUsers');

const LEAVE_POPULATE = [
  {
    path: 'userId',
    select: 'organizationId name email department languagePreference role leaveBalance'
  },
  {
    path: 'approvedBy',
    select: 'organizationId name email role'
  }
];

const PRIVILEGED_LEAVE_ROLES = new Set([
  'platform_admin',
  'organization_admin'
]);

const SELF_ONLY_LEAVE_ROLES = new Set([
  'employee',
  'qr_manager'
]);

const LEAVE_TYPE_LABELS = {
  vacation: { en: 'Vacation', ar: 'إجازة' },
  sick: { en: 'Sick', ar: 'مرضية' },
  permission: { en: 'Permission', ar: 'إذن' },
  emergency: { en: 'Emergency', ar: 'طارئ' },
  unpaid: { en: 'Unpaid', ar: 'بدون راتب' },
  other: { en: 'Other', ar: 'أخرى' }
};

const sendControllerError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.message
});

const parseRequestedDates = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw createHttpError(400, 'Please provide valid leave dates');
  }

  if (end < start) {
    throw createHttpError(400, 'End date cannot be before start date');
  }

  return { start, end };
};

const calculateLeaveDays = ({ type, start, end, days }) => {
  if (days !== undefined && days !== null && Number(days) > 0) {
    return parseFloat(Number(days).toFixed(2));
  }

  const diffTime = Math.abs(end - start);

  if (type === 'permission') {
    return parseFloat((diffTime / (1000 * 60 * 60 * 8)).toFixed(2));
  }

  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

const resolveLeaveOrganization = async (req, fallbackOrganizationId = null) => (
  resolveScopedOrganization(req, fallbackOrganizationId)
);

const populateLeave = async (leave) => leave.populate(LEAVE_POPULATE);

const getOrganizationUserOrThrow = async (organizationId, userId, extraQuery = {}) => {
  const user = await User.findOne({
    _id: userId,
    organizationId,
    ...extraQuery
  })
    .select('_id organizationId name email department languagePreference role leaveBalance')
    .lean();

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const resolveLeaveUserScope = async (
  req,
  organization,
  { requestedUserId = null, requestedDepartment = null } = {}
) => {
  const normalizedRole = normalizeRole(req.user.role);
  const normalizedDepartment = requestedDepartment
    ? normalizeDepartmentCode(requestedDepartment)
    : null;
  const currentUserId = req.user._id || req.user.id;

  if (SELF_ONLY_LEAVE_ROLES.has(normalizedRole)) {
    if (requestedUserId && String(requestedUserId) !== String(currentUserId)) {
      throw createHttpError(403, 'You do not have access to other users leave requests');
    }

    if (
      normalizedDepartment &&
      normalizedDepartment !== normalizeDepartmentCode(req.user.department)
    ) {
      throw createHttpError(403, 'You do not have access to this department');
    }

    return {
      userId: currentUserId,
      userIds: [currentUserId]
    };
  }

  if (normalizedRole === 'supervisor') {
    if (normalizedDepartment) {
      ensureDepartmentAccess(req.user, normalizedDepartment, 'You do not have access to this department');
    }

    if (requestedUserId) {
      const scopedUser = await getOrganizationUserOrThrow(organization._id, requestedUserId);
      ensureDepartmentAccess(req.user, scopedUser.department, 'You do not have access to this user');

      if (
        normalizedDepartment &&
        normalizeDepartmentCode(scopedUser.department) !== normalizedDepartment
      ) {
        throw createHttpError(403, 'User does not belong to this department');
      }

      return {
        userId: scopedUser._id,
        userIds: [scopedUser._id]
      };
    }

    if (normalizedDepartment) {
      return {
        userIds: await getOrganizationDepartmentUserIds(
          organization._id,
          [normalizedDepartment]
        )
      };
    }

    const managedDepartments = getManagedDepartments(req.user);
    if (!managedDepartments) {
      return {
        userIds: null
      };
    }

    return {
      userIds: await getOrganizationDepartmentUserIds(
        organization._id,
        Array.from(managedDepartments)
      )
    };
  }

  if (PRIVILEGED_LEAVE_ROLES.has(normalizedRole)) {
    if (requestedUserId) {
      const extraQuery = normalizedDepartment
        ? { department: normalizedDepartment }
        : {};
      const scopedUser = await getOrganizationUserOrThrow(
        organization._id,
        requestedUserId,
        extraQuery
      );

      return {
        userId: scopedUser._id,
        userIds: [scopedUser._id]
      };
    }

    if (normalizedDepartment) {
      return {
        userIds: await getOrganizationDepartmentUserIds(
          organization._id,
          [normalizedDepartment]
        )
      };
    }

    return {
      userIds: null
    };
  }

  throw createHttpError(403, 'You do not have access to leave data');
};

const applyUserScopeToLeaveQuery = (query, scope) => {
  if (!scope || scope.userIds === null) {
    return query;
  }

  if (scope.userId) {
    query.userId = scope.userId;
    return query;
  }

  query.userId = { $in: scope.userIds };
  return query;
};

const ensureLeaveReadAccess = async (req, organization, leave) => {
  const normalizedRole = normalizeRole(req.user.role);
  const leaveOwnerId = leave.userId?._id || leave.userId;

  if (PRIVILEGED_LEAVE_ROLES.has(normalizedRole)) {
    return;
  }

  if (normalizedRole === 'supervisor') {
    const leaveOwner = await getOrganizationUserOrThrow(organization._id, leaveOwnerId);
    ensureDepartmentAccess(req.user, leaveOwner.department, 'You do not have access to this leave request');
    return;
  }

  if (String(leaveOwnerId) !== String(req.user._id || req.user.id)) {
    throw createHttpError(403, 'You do not have access to this leave request');
  }
};

const getLeaveLabels = (type) => LEAVE_TYPE_LABELS[type] || {
  en: type,
  ar: type
};

// @desc    Get all leave requests
// @route   GET /api/leaves
// @access  Private
exports.getLeaveRequests = async (req, res) => {
  try {
    const organization = await resolveLeaveOrganization(req);
    const { status, type, userId, dateFrom, dateTo, department } = req.query;
    const scope = await resolveLeaveUserScope(req, organization, {
      requestedUserId: userId || null,
      requestedDepartment: department || null
    });
    const query = applyUserScopeToLeaveQuery(buildTenantQuery(organization, {}), scope);

    if (status) query.status = status;
    if (type) query.type = type;

    if (dateFrom || dateTo) {
      query.startDate = {};
      if (dateFrom) query.startDate.$gte = new Date(dateFrom);
      if (dateTo) query.startDate.$lte = new Date(dateTo);
    }

    const leaves = await LeaveRequest.find(query)
      .populate(LEAVE_POPULATE)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: leaves.length,
      data: leaves
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get single leave request
// @route   GET /api/leaves/:id
// @access  Private
exports.getLeaveRequest = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const organization = await resolveLeaveOrganization(req, leave.organizationId);
    await ensureLeaveReadAccess(req, organization, leave);
    await populateLeave(leave);

    res.json({
      success: true,
      data: leave
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Create leave request
// @route   POST /api/leaves
// @access  Private
exports.createLeaveRequest = async (req, res) => {
  try {
    const organization = await resolveLeaveOrganization(req);
    const { type, startDate, endDate, reason, days } = req.body;

    if (!type || !startDate || !endDate || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    const { start, end } = parseRequestedDates(startDate, endDate);
    const calculatedDays = calculateLeaveDays({ type, start, end, days });

    const overlapping = await LeaveRequest.findOne(buildTenantQuery(organization, {
      userId: req.user.id,
      status: { $in: ['pending', 'approved'] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    }));

    if (overlapping) {
      return res.status(400).json({
        success: false,
        message: 'You already have a leave request for this period'
      });
    }

    const leave = await LeaveRequest.create(attachOrganizationId({
      userId: req.user.id,
      type,
      startDate: start,
      endDate: end,
      reason,
      days: calculatedDays,
      status: 'pending'
    }, organization));

    await populateLeave(leave);

    const leaveLabels = getLeaveLabels(type);
    const userName = leave.userId?.name || req.user.name || 'User';

    await createNotification({
      organizationId: organization._id,
      type: 'leave_requested',
      title: {
        en: 'New Leave Request',
        ar: 'طلب إجازة جديد'
      },
      message: {
        en: `${userName} requested ${calculatedDays} day(s) of ${leaveLabels.en} leave`,
        ar: `${userName} طلب ${calculatedDays} يوم من إجازة ${leaveLabels.ar}`
      },
      data: {
        leaveId: leave._id,
        userId: leave.userId?._id || leave.userId,
        type,
        days: calculatedDays,
        startDate: start.toISOString(),
        endDate: end.toISOString()
      }
    });

    await sendEmailToAdmins(
      (language) => getLeaveRequestedEmail({
        userName,
        leaveType: leaveLabels,
        days: calculatedDays,
        startDate: start,
        endDate: end,
        department: leave.userId?.department || req.user.department || 'N/A'
      }, language),
      null,
      organization._id
    );

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'leave_request.created',
      entityType: 'leave_request',
      entityId: leave._id,
      metadata: {
        type,
        days: leave.days,
        startDate: leave.startDate,
        endDate: leave.endDate
      }
    });

    res.status(201).json({
      success: true,
      data: leave
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Update leave request
// @route   PUT /api/leaves/:id
// @access  Private
exports.updateLeaveRequest = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const organization = await resolveLeaveOrganization(req, leave.organizationId);
    const normalizedRole = normalizeRole(req.user.role);
    const isPrivileged = PRIVILEGED_LEAVE_ROLES.has(normalizedRole);
    const isOwner = String(leave.userId) === String(req.user._id || req.user.id);

    if (!isPrivileged && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this leave request'
      });
    }

    if (!isPrivileged && leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update a leave request that has been processed'
      });
    }

    const nextType = req.body.type !== undefined ? req.body.type : leave.type;
    const nextReason = req.body.reason !== undefined ? req.body.reason : leave.reason;
    const nextStartDate = req.body.startDate !== undefined ? req.body.startDate : leave.startDate;
    const nextEndDate = req.body.endDate !== undefined ? req.body.endDate : leave.endDate;
    const { start, end } = parseRequestedDates(nextStartDate, nextEndDate);

    const overlapping = await LeaveRequest.findOne(buildTenantQuery(organization, {
      _id: { $ne: leave._id },
      userId: leave.userId,
      status: { $in: ['pending', 'approved'] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    }));

    if (overlapping) {
      return res.status(400).json({
        success: false,
        message: 'You already have a leave request for this period'
      });
    }

    leave.type = nextType;
    leave.startDate = start;
    leave.endDate = end;
    leave.reason = nextReason;
    leave.days = calculateLeaveDays({
      type: nextType,
      start,
      end,
      days: req.body.days !== undefined ? req.body.days : leave.days
    });

    await leave.save();
    await populateLeave(leave);

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'leave_request.updated',
      entityType: 'leave_request',
      entityId: leave._id,
      metadata: {
        type: leave.type,
        status: leave.status,
        days: leave.days,
        changedFields: Object.keys(req.body || {})
      }
    });

    res.json({
      success: true,
      data: leave
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Delete leave request
// @route   DELETE /api/leaves/:id
// @access  Private
exports.deleteLeaveRequest = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const organization = await resolveLeaveOrganization(req, leave.organizationId);

    if (String(leave.userId) !== String(req.user._id || req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this leave request'
      });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a leave request that has been processed'
      });
    }

    await leave.deleteOne();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'leave_request.deleted',
      entityType: 'leave_request',
      entityId: leave._id,
      metadata: {
        type: leave.type,
        days: leave.days,
        status: leave.status
      }
    });

    res.json({
      success: true,
      message: 'Leave request deleted successfully'
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Approve/Reject leave request
// @route   PUT /api/leaves/:id/approve
// @access  Private (Admin, Supervisor)
exports.approveLeaveRequest = async (req, res) => {
  try {
    const { status, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either approved or rejected'
      });
    }

    const leave = await LeaveRequest.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const organization = await resolveLeaveOrganization(req, leave.organizationId);
    const normalizedRole = normalizeRole(req.user.role);
    const leaveOwner = await getOrganizationUserOrThrow(organization._id, leave.userId);

    if (normalizedRole === 'supervisor') {
      ensureDepartmentAccess(
        req.user,
        leaveOwner.department,
        'You do not have access to approve this leave request'
      );
    } else if (!PRIVILEGED_LEAVE_ROLES.has(normalizedRole)) {
      throw createHttpError(403, 'You do not have access to approve this leave request');
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This leave request has already been processed'
      });
    }

    leave.status = status;
    leave.approvedBy = req.user.id;
    leave.approvalDate = Date.now();
    leave.approvalNotes = notes || '';

    await leave.save();

    if (status === 'approved') {
      const user = await User.findOne({
        _id: leave.userId,
        organizationId: organization._id
      });

      if (user && user.leaveBalance >= leave.days) {
        user.leaveBalance -= leave.days;
        await user.save();
      }
    }

    await populateLeave(leave);

    const leaveLabels = getLeaveLabels(leave.type);
    const action = status === 'approved' ? 'approved' : 'rejected';
    const userName = leave.userId?.name || 'User';

    await createNotification({
      organizationId: organization._id,
      type: `leave_${action}`,
      title: {
        en: `Leave Request ${action === 'approved' ? 'Approved' : 'Rejected'}`,
        ar: action === 'approved'
          ? 'تمت الموافقة على طلب الإجازة'
          : 'تم رفض طلب الإجازة'
      },
      message: {
        en: `Leave request from ${userName} (${leave.days} day(s) ${leaveLabels.en}) has been ${action}`,
        ar: action === 'approved'
          ? `تمت الموافقة على طلب إجازة من ${userName} (${leave.days} يوم ${leaveLabels.ar})`
          : `تم رفض طلب إجازة من ${userName} (${leave.days} يوم ${leaveLabels.ar})`
      },
      data: {
        leaveId: leave._id,
        userId: leave.userId?._id || leave.userId,
        approvedBy: leave.approvedBy?._id || leave.approvedBy,
        type: leave.type,
        days: leave.days,
        status
      }
    });

    if (leave.userId?.email) {
      const userLanguage = leave.userId.languagePreference || 'ar';

      if (status === 'approved') {
        await sendEmailToUser(
          leave.userId.email,
          (language) => getLeaveApprovedEmail({
            leaveType: leaveLabels,
            days: leave.days,
            startDate: leave.startDate,
            endDate: leave.endDate,
            approvedBy: leave.approvedBy
          }, language),
          userLanguage
        );
      } else {
        await sendEmailToUser(
          leave.userId.email,
          (language) => getLeaveRejectedEmail({
            leaveType: leaveLabels,
            days: leave.days,
            startDate: leave.startDate,
            endDate: leave.endDate,
            rejectedBy: leave.approvedBy,
            rejectionNotes: notes || ''
          }, language),
          userLanguage
        );
      }
    }

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: `leave_request.${status}`,
      entityType: 'leave_request',
      entityId: leave._id,
      metadata: {
        type: leave.type,
        days: leave.days,
        approvalNotes: notes || '',
        targetUserId: leave.userId?._id || leave.userId
      }
    });

    res.json({
      success: true,
      data: leave
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Cancel leave request
// @route   PUT /api/leaves/:id/cancel
// @access  Private
exports.cancelLeaveRequest = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);

    if (!leave) {
      return res.status(404).json({
        success: false,
        message: 'Leave request not found'
      });
    }

    const organization = await resolveLeaveOrganization(req, leave.organizationId);

    if (String(leave.userId) !== String(req.user._id || req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to cancel this leave request'
      });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Can only cancel pending leave requests'
      });
    }

    leave.status = 'cancelled';
    await leave.save();
    await populateLeave(leave);

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'leave_request.cancelled',
      entityType: 'leave_request',
      entityId: leave._id,
      metadata: {
        type: leave.type,
        days: leave.days
      }
    });

    res.json({
      success: true,
      data: leave
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get leave statistics
// @route   GET /api/leaves/stats/summary
// @access  Private (Admin, Supervisor)
exports.getLeaveStats = async (req, res) => {
  try {
    const organization = await resolveLeaveOrganization(req);
    const { dateFrom, dateTo, department } = req.query;
    const scope = await resolveLeaveUserScope(req, organization, {
      requestedDepartment: department || null
    });
    const matchQuery = applyUserScopeToLeaveQuery(buildTenantQuery(organization, {}), scope);

    if (dateFrom || dateTo) {
      matchQuery.startDate = {};
      if (dateFrom) matchQuery.startDate.$gte = new Date(dateFrom);
      if (dateTo) matchQuery.startDate.$lte = new Date(dateTo);
    }

    const [stats, byType, totalRequests] = await Promise.all([
      LeaveRequest.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalDays: { $sum: '$days' }
          }
        }
      ]),
      LeaveRequest.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            totalDays: { $sum: '$days' }
          }
        }
      ]),
      LeaveRequest.countDocuments(matchQuery)
    ]);

    res.json({
      success: true,
      data: {
        total: totalRequests,
        byStatus: stats,
        byType
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get my leave balance
// @route   GET /api/leaves/my-balance
// @access  Private
exports.getMyLeaveBalance = async (req, res) => {
  try {
    const organization = await resolveLeaveOrganization(req);
    const user = await User.findOne({
      _id: req.user.id,
      organizationId: organization._id
    })
      .select('leaveBalance')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const approvedLeaves = await LeaveRequest.find(buildTenantQuery(organization, {
      userId: req.user.id,
      status: 'approved'
    }))
      .select('days')
      .lean();

    const usedDays = approvedLeaves.reduce((sum, leave) => sum + leave.days, 0);

    res.json({
      success: true,
      data: {
        totalBalance: user.leaveBalance,
        usedDays,
        remainingDays: user.leaveBalance
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
