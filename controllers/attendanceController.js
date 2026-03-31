const AttendanceToken = require('../models/AttendanceToken');
const AttendanceLog = require('../models/AttendanceLog');
const User = require('../models/User');
const { createNotification } = require('../utils/notifications');
const { checkAbsentUsers } = require('../utils/checkAbsentUsers');
const logger = require('../utils/logger');
const dateUtils = require('../utils/dateUtils');
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

const ATTENDANCE_POPULATE = [
  {
    path: 'userId',
    select: 'organizationId name email department role'
  },
  {
    path: 'tokenId',
    select: 'organizationId sequenceNumber token status validFrom validTo usageCount'
  }
];

const PRIVILEGED_ATTENDANCE_ROLES = new Set([
  'platform_admin',
  'organization_admin',
  'qr_manager'
]);

const DEFAULT_QR_TOKEN_VALIDITY_SECONDS = 30;

const sendControllerError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.message
});

const populateAttendanceLog = async (log) => log.populate(ATTENDANCE_POPULATE);

const parsePagination = (page, limit) => {
  const normalizedPage = Math.max(parseInt(page, 10) || 1, 1);
  const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit
  };
};

const resolveAttendanceOrganization = async (req, fallbackOrganizationId = null) => (
  resolveScopedOrganization(req, fallbackOrganizationId)
);

const getQrTokenValiditySeconds = (organization) => {
  const configuredSeconds = parseInt(
    organization?.attendanceSettings?.qrTokenValiditySeconds,
    10
  );

  if (Number.isFinite(configuredSeconds) && configuredSeconds > 0) {
    return configuredSeconds;
  }

  const envSeconds = parseInt(process.env.QR_TOKEN_VALIDITY_SECONDS, 10);

  if (Number.isFinite(envSeconds) && envSeconds > 0) {
    return envSeconds;
  }

  return DEFAULT_QR_TOKEN_VALIDITY_SECONDS;
};

const getOrganizationUserOrThrow = async (organizationId, userId, extraQuery = {}) => {
  const user = await User.findOne({
    _id: userId,
    organizationId,
    ...extraQuery
  })
    .select('_id organizationId department')
    .lean();

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const resolveAttendanceUserScope = async (
  req,
  organization,
  { requestedUserId = null, requestedDepartment = null } = {}
) => {
  const normalizedRole = normalizeRole(req.user.role);
  const normalizedDepartment = requestedDepartment
    ? normalizeDepartmentCode(requestedDepartment)
    : null;
  const currentUserId = req.user._id || req.user.id;

  if (normalizedRole === 'employee') {
    if (requestedUserId && String(requestedUserId) !== String(currentUserId)) {
      throw createHttpError(403, 'You do not have access to other users attendance');
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

  if (PRIVILEGED_ATTENDANCE_ROLES.has(normalizedRole)) {
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

  throw createHttpError(403, 'You do not have access to attendance data');
};

const applyAttendanceUserScope = (query, scope) => {
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

const groupAttendanceByDate = (logs, limit) => {
  const checkIns = logs
    .filter((log) => log.type === 'checkin')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const checkOuts = logs
    .filter((log) => log.type === 'checkout')
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const groupedByDate = {};

  checkIns.forEach((checkIn) => {
    const date = dateUtils.getDateString(checkIn.timestamp);
    if (!groupedByDate[date]) {
      groupedByDate[date] = {
        date,
        checkin: null,
        checkout: null
      };
    }

    if (
      !groupedByDate[date].checkin ||
      new Date(checkIn.timestamp) < new Date(groupedByDate[date].checkin.timestamp)
    ) {
      groupedByDate[date].checkin = checkIn;
    }
  });

  checkOuts.forEach((checkOut) => {
    const correspondingCheckIn = checkIns
      .filter((checkIn) => new Date(checkIn.timestamp) < new Date(checkOut.timestamp))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    if (correspondingCheckIn) {
      const checkInDate = dateUtils.getDateString(correspondingCheckIn.timestamp);

      if (!groupedByDate[checkInDate]) {
        groupedByDate[checkInDate] = {
          date: checkInDate,
          checkin: null,
          checkout: null
        };
      }

      if (
        !groupedByDate[checkInDate].checkout ||
        new Date(checkOut.timestamp) > new Date(groupedByDate[checkInDate].checkout.timestamp)
      ) {
        groupedByDate[checkInDate].checkout = checkOut;
      }

      return;
    }

    const date = dateUtils.getDateString(checkOut.timestamp);
    if (!groupedByDate[date]) {
      groupedByDate[date] = {
        date,
        checkin: null,
        checkout: null
      };
    }

    if (
      !groupedByDate[date].checkout ||
      new Date(checkOut.timestamp) > new Date(groupedByDate[date].checkout.timestamp)
    ) {
      groupedByDate[date].checkout = checkOut;
    }
  });

  return Object.values(groupedByDate)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
};

// Auto-generate QR code (called by cron job or manually by admin)
exports.generateQRCode = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const sequenceNumber = await AttendanceToken.getNextSequence(organization._id);
    const token = AttendanceToken.generateToken();
    const validitySeconds = getQrTokenValiditySeconds(organization);
    const validityMs = validitySeconds * 1000;
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + validityMs);

    const qrToken = await AttendanceToken.create(attachOrganizationId({
      token,
      validFrom,
      validTo,
      status: 'active',
      sequenceNumber,
      createdBy: req.user?._id || req.user?.id
    }, organization));

    await AttendanceToken.updateMany(
      {
        organizationId: organization._id,
        _id: { $ne: qrToken._id },
        status: 'active'
      },
      { status: 'expired' }
    );

    const tokensToKeep = await AttendanceToken.find({
      organizationId: organization._id
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('_id');

    await AttendanceToken.deleteMany({
      organizationId: organization._id,
      _id: { $nin: tokensToKeep.map((tokenEntry) => tokenEntry._id) }
    });

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'attendance_token.created',
      entityType: 'attendance_token',
      entityId: qrToken._id,
      metadata: {
        sequenceNumber: qrToken.sequenceNumber,
        validFrom: qrToken.validFrom,
        validTo: qrToken.validTo
      }
    });

    logger.log(
      `Generated attendance QR #${sequenceNumber} for organization ${organization._id}`
    );

    res.json({
      success: true,
      data: {
        token: qrToken.token,
        validFrom: qrToken.validFrom,
        validTo: qrToken.validTo,
        sequenceNumber: qrToken.sequenceNumber,
        usageCount: qrToken.usageCount || 0,
        expiresIn: validitySeconds
      }
    });
  } catch (error) {
    logger.error('Error generating QR code:', error);
    sendControllerError(res, error);
  }
};

// Get current active QR code
exports.getCurrentQR = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const currentQR = await AttendanceToken.findOne({
      organizationId: organization._id,
      status: 'active',
      validTo: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    if (!currentQR) {
      return res.status(404).json({
        success: false,
        message: 'No active QR code found'
      });
    }

    if (!currentQR.isValid()) {
      await currentQR.expire();
      return res.status(404).json({
        success: false,
        message: 'QR code has expired'
      });
    }

    const now = new Date();
    const expiresIn = Math.max(0, Math.floor((currentQR.validTo - now) / 1000));

    res.json({
      success: true,
      data: {
        token: currentQR.token,
        validFrom: currentQR.validFrom,
        validTo: currentQR.validTo,
        sequenceNumber: currentQR.sequenceNumber,
        expiresIn,
        usageCount: currentQR.usageCount
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Validate QR token (public endpoint)
exports.validateQRToken = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const { token } = req.params;

    const qrToken = await AttendanceToken.findOne({
      organizationId: organization._id,
      token
    });

    if (!qrToken) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code'
      });
    }

    if (!qrToken.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'QR code has expired or is no longer active'
      });
    }

    const now = new Date();
    const expiresIn = Math.max(0, Math.floor((qrToken.validTo - now) / 1000));

    res.json({
      success: true,
      data: {
        valid: true,
        expiresIn,
        sequenceNumber: qrToken.sequenceNumber
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Record attendance (check-in or check-out)
exports.recordAttendance = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const { token, type } = req.body;

    if (!token || !type) {
      return res.status(400).json({
        success: false,
        message: 'Token and type are required'
      });
    }

    if (!['checkin', 'checkout'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Type must be either checkin or checkout'
      });
    }

    const qrToken = await AttendanceToken.findOne({
      organizationId: organization._id,
      token
    });

    if (!qrToken) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code'
      });
    }

    if (!qrToken.isValid()) {
      return res.status(400).json({
        success: false,
        message: 'QR code has expired or is no longer active'
      });
    }

    const todayStart = dateUtils.getStartOfToday();
    const todayEnd = dateUtils.getEndOfToday();

    const todayAttendance = await AttendanceLog.find(buildTenantQuery(organization, {
      userId: req.user.id,
      timestamp: {
        $gte: todayStart,
        $lte: todayEnd
      }
    })).sort({ timestamp: 1 });

    const hasCheckInToday = todayAttendance.some((log) => log.type === 'checkin');
    const hasCheckOutToday = todayAttendance.some((log) => log.type === 'checkout');

    if (type === 'checkin' && hasCheckInToday) {
      return res.status(400).json({
        success: false,
        message: 'You have already checked in today'
      });
    }

    if (type === 'checkout') {
      const recentCheckIns = await AttendanceLog.find(buildTenantQuery(organization, {
        userId: req.user.id,
        type: 'checkin'
      }))
        .sort({ timestamp: -1 })
        .limit(1);

      if (recentCheckIns.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'You must check in before checking out'
        });
      }

      const lastCheckIn = recentCheckIns[0];

      const hasCheckOutAfterCheckIn = await AttendanceLog.findOne(buildTenantQuery(organization, {
        userId: req.user.id,
        type: 'checkout',
        timestamp: { $gt: lastCheckIn.timestamp }
      }));

      if (hasCheckOutAfterCheckIn && !hasCheckInToday) {
        return res.status(400).json({
          success: false,
          message: 'You must check in before checking out'
        });
      }

      if (hasCheckOutToday) {
        const lastCheckInDate = dateUtils.getDateString(lastCheckIn.timestamp);
        const todayDate = dateUtils.getDateString(new Date());

        if (lastCheckInDate === todayDate) {
          return res.status(400).json({
            success: false,
            message: 'You have already checked out today'
          });
        }
      }
    }

    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    const attendanceLog = await AttendanceLog.create(attachOrganizationId({
      userId: req.user.id,
      type,
      timestamp: new Date(),
      method: 'qr',
      tokenId: qrToken._id,
      metadata: {
        ip,
        userAgent,
        qrSequence: qrToken.sequenceNumber
      }
    }, organization));

    await qrToken.markAsUsed();
    await populateAttendanceLog(attendanceLog);

    if (type === 'checkin') {
      const user = await User.findOne(buildTenantQuery(organization, {
        _id: req.user.id
      })).select('workDays workSchedule');

      if (user && Array.isArray(user.workDays) && user.workDays.length > 0) {
        const dayName = dateUtils.getDayName(new Date());

        if (user.workDays.includes(dayName) && user.workSchedule && user.workSchedule[dayName]) {
          const expectedStartTime = user.workSchedule[dayName].startTime;

          if (expectedStartTime) {
            const [expectedHours, expectedMinutes] = expectedStartTime
              .split(':')
              .map(Number);
            const todayComponents = dateUtils.getDateComponents(new Date());
            const expectedTime = dateUtils.createDate(
              todayComponents.year,
              todayComponents.month,
              todayComponents.day,
              expectedHours,
              expectedMinutes,
              0
            );

            const checkinTime = new Date(attendanceLog.timestamp);
            if (checkinTime > expectedTime) {
              const lateMinutes = Math.floor((checkinTime - expectedTime) / (1000 * 60));

              await createNotification({
                organizationId: organization._id,
                type: 'user_late',
                title: {
                  en: 'Employee Late Arrival',
                  ar: 'تأخر موظف'
                },
                message: {
                  en: `${req.user.name} arrived ${lateMinutes} minute(s) late`,
                  ar: `${req.user.name} وصل متأخراً ${lateMinutes} دقيقة`
                },
                data: {
                  userId: req.user.id,
                  attendanceLogId: attendanceLog._id,
                  lateMinutes,
                  expectedTime: expectedStartTime,
                  actualTime: checkinTime.toISOString()
                }
              });
            }
          }
        }
      }
    }

    res.json({
      success: true,
      message: type === 'checkin'
        ? 'Checked in successfully'
        : 'Checked out successfully',
      data: attendanceLog
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Get my attendance logs
exports.getMyAttendance = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const { startDate, endDate, limit = 30 } = req.query;
    const query = buildTenantQuery(organization, { userId: req.user.id });

    if (!startDate && !endDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      query.timestamp = { $gte: thirtyDaysAgo };
    } else if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const logs = await AttendanceLog.find(query)
      .sort({ timestamp: -1 })
      .populate(ATTENDANCE_POPULATE);

    const formattedLogs = groupAttendanceByDate(logs, parseInt(limit, 10) || 30);

    res.json({
      success: true,
      count: formattedLogs.length,
      data: formattedLogs
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Get attendance stats
exports.getAttendanceStats = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const { department } = req.query;
    const todayStart = dateUtils.getStartOfToday();
    const todayEnd = dateUtils.getEndOfToday();
    const scope = await resolveAttendanceUserScope(req, organization, {
      requestedDepartment: department || null
    });

    const todayQuery = applyAttendanceUserScope(buildTenantQuery(organization, {
      timestamp: { $gte: todayStart, $lte: todayEnd }
    }), scope);
    const todayCheckinQuery = {
      ...todayQuery,
      type: 'checkin'
    };
    const todayCheckoutQuery = {
      ...todayQuery,
      type: 'checkout'
    };

    const [
      todayLogs,
      todayCheckins,
      todayCheckouts,
      uniqueUsers,
      activeQRCount,
      totalQRs
    ] = await Promise.all([
      AttendanceLog.countDocuments(todayQuery),
      AttendanceLog.countDocuments(todayCheckinQuery),
      AttendanceLog.countDocuments(todayCheckoutQuery),
      AttendanceLog.distinct('userId', todayQuery),
      AttendanceToken.countDocuments({
        organizationId: organization._id,
        status: 'active'
      }),
      AttendanceToken.countDocuments({
        organizationId: organization._id
      })
    ]);

    res.json({
      success: true,
      data: {
        today: {
          totalLogs: todayLogs,
          checkins: todayCheckins,
          checkouts: todayCheckouts,
          uniqueUsers: uniqueUsers.length
        },
        qr: {
          active: activeQRCount,
          total: totalQRs
        }
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Get attendance logs
exports.getAllAttendance = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const {
      startDate,
      endDate,
      userId,
      department,
      type,
      limit = 100,
      page = 1
    } = req.query;
    const pagination = parsePagination(page, limit);
    const scope = await resolveAttendanceUserScope(req, organization, {
      requestedUserId: userId || null,
      requestedDepartment: department || null
    });
    const query = applyAttendanceUserScope(buildTenantQuery(organization, {}), scope);

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    if (type) {
      query.type = type;
    }

    const [logs, total] = await Promise.all([
      AttendanceLog.find(query)
        .sort({ timestamp: -1 })
        .limit(pagination.limit)
        .skip(pagination.skip)
        .populate(ATTENDANCE_POPULATE),
      AttendanceLog.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        pages: Math.ceil(total / pagination.limit)
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Get all attendance grouped by date
exports.getAllAttendanceGrouped = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const {
      startDate,
      endDate,
      userId,
      department,
      limit = 30
    } = req.query;
    const scope = await resolveAttendanceUserScope(req, organization, {
      requestedUserId: userId || null,
      requestedDepartment: department || null
    });
    const query = applyAttendanceUserScope(buildTenantQuery(organization, {}), scope);

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    } else {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      query.timestamp = { $gte: thirtyDaysAgo };
    }

    const logs = await AttendanceLog.find(query)
      .sort({ timestamp: -1 })
      .populate(ATTENDANCE_POPULATE);

    const validLogs = logs.filter((log) => log.userId && log.userId._id);
    const userLogs = {};

    validLogs.forEach((log) => {
      const currentUserId = String(log.userId._id || log.userId);

      if (!userLogs[currentUserId]) {
        userLogs[currentUserId] = {
          userId: log.userId,
          checkIns: [],
          checkOuts: []
        };
      }

      if (log.type === 'checkin') {
        userLogs[currentUserId].checkIns.push(log);
      } else if (log.type === 'checkout') {
        userLogs[currentUserId].checkOuts.push(log);
      }
    });

    Object.values(userLogs).forEach((entry) => {
      entry.checkIns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      entry.checkOuts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    });

    const groupedByDateAndUser = {};

    Object.values(userLogs).forEach(({ userId: groupedUser, checkIns }) => {
      checkIns.forEach((checkIn) => {
        const date = dateUtils.getDateString(checkIn.timestamp);
        const key = `${date}_${groupedUser._id}`;

        if (!groupedByDateAndUser[key]) {
          groupedByDateAndUser[key] = {
            date,
            userId: groupedUser,
            checkin: null,
            checkout: null
          };
        }

        if (
          !groupedByDateAndUser[key].checkin ||
          new Date(checkIn.timestamp) < new Date(groupedByDateAndUser[key].checkin.timestamp)
        ) {
          groupedByDateAndUser[key].checkin = checkIn;
        }
      });
    });

    Object.values(userLogs).forEach(({ userId: groupedUser, checkIns, checkOuts }) => {
      checkOuts.forEach((checkOut) => {
        const correspondingCheckIn = checkIns
          .filter((checkIn) => new Date(checkIn.timestamp) < new Date(checkOut.timestamp))
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

        if (correspondingCheckIn) {
          const checkInDate = dateUtils.getDateString(correspondingCheckIn.timestamp);
          const key = `${checkInDate}_${groupedUser._id}`;

          if (!groupedByDateAndUser[key]) {
            groupedByDateAndUser[key] = {
              date: checkInDate,
              userId: groupedUser,
              checkin: null,
              checkout: null
            };
          }

          if (
            !groupedByDateAndUser[key].checkout ||
            new Date(checkOut.timestamp) > new Date(groupedByDateAndUser[key].checkout.timestamp)
          ) {
            groupedByDateAndUser[key].checkout = checkOut;
          }

          return;
        }

        const date = dateUtils.getDateString(checkOut.timestamp);
        const key = `${date}_${groupedUser._id}`;

        if (!groupedByDateAndUser[key]) {
          groupedByDateAndUser[key] = {
            date,
            userId: groupedUser,
            checkin: null,
            checkout: null
          };
        }

        if (
          !groupedByDateAndUser[key].checkout ||
          new Date(checkOut.timestamp) > new Date(groupedByDateAndUser[key].checkout.timestamp)
        ) {
          groupedByDateAndUser[key].checkout = checkOut;
        }
      });
    });

    const formattedLogs = Object.values(groupedByDateAndUser)
      .sort((a, b) => {
        const dateCompare = new Date(b.date) - new Date(a.date);
        if (dateCompare !== 0) {
          return dateCompare;
        }

        return (a.userId?.name || '').localeCompare(b.userId?.name || '');
      })
      .slice(0, parseInt(limit, 10) || 30);

    res.json({
      success: true,
      count: formattedLogs.length,
      data: formattedLogs
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Check for absent users
exports.checkAbsentUsers = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);
    const result = await checkAbsentUsers({
      organizationId: organization._id
    });

    res.json({
      success: true,
      message: 'Absent users check completed',
      data: result
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Cleanup expired QR codes
exports.cleanupExpiredQRs = async (req, res) => {
  try {
    const organization = await resolveAttendanceOrganization(req);

    await AttendanceToken.updateMany(
      {
        organizationId: organization._id,
        status: 'active',
        validTo: { $lt: new Date() }
      },
      { status: 'expired' }
    );

    const tokensToKeep = await AttendanceToken.find({
      organizationId: organization._id
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('_id');

    const deleteResult = await AttendanceToken.deleteMany({
      organizationId: organization._id,
      _id: { $nin: tokensToKeep.map((tokenEntry) => tokenEntry._id) }
    });

    res.json({
      success: true,
      message: 'Cleanup completed',
      data: {
        deleted: deleteResult.deletedCount,
        kept: tokensToKeep.length
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// Update attendance log timestamp
exports.updateAttendanceLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { timestamp, notes } = req.body;

    const log = await AttendanceLog.findById(id);

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Attendance log not found'
      });
    }

    const organization = await resolveAttendanceOrganization(req, log.organizationId);

    if (timestamp) {
      log.timestamp = new Date(timestamp);
    }

    if (notes !== undefined) {
      log.notes = notes;
    }

    log.method = 'manual';
    await log.save();
    await populateAttendanceLog(log);

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'attendance_log.updated',
      entityType: 'attendance_log',
      entityId: log._id,
      metadata: {
        timestamp: log.timestamp,
        notes: log.notes || ''
      }
    });

    res.json({
      success: true,
      message: 'Attendance log updated successfully',
      data: log
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
