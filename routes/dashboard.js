const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const FormInstance = require('../models/FormInstance');
const LeaveRequest = require('../models/LeaveRequest');
const AttendanceLog = require('../models/AttendanceLog');
const User = require('../models/User');
const cache = require('../utils/cache');
const logger = require('../utils/logger');
const dateUtils = require('../utils/dateUtils');
const { buildTenantQuery } = require('../utils/tenantScope');
const {
  getManagedDepartments,
  resolveScopedOrganization
} = require('../utils/formAccess');
const { normalizeRole } = require('../utils/tenantConstants');
const { getOrganizationDepartmentUserIds } = require('../utils/scopedUsers');

const EMPLOYEE_LIKE_ROLES = new Set(['employee', 'qr_manager']);

// @desc    Get dashboard summary
// @route   GET /api/dashboard/summary
// @access  Private
router.get('/summary', protect, async (req, res) => {
  try {
    const organization = await resolveScopedOrganization(req);
    const normalizedRole = normalizeRole(req.user.role);
    const cacheKey = cache.key(
      'dashboard',
      organization._id,
      normalizedRole,
      req.user.id
    );

    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true
      });
    }

    const todayStart = dateUtils.getStartOfToday();
    const todayEnd = dateUtils.getEndOfToday();
    const thisWeekStart = new Date(todayStart);
    thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
    const monthStart = new Date(todayStart);
    monthStart.setDate(1);

    if (EMPLOYEE_LIKE_ROLES.has(normalizedRole)) {
      const [
        user,
        todayCheckin,
        todayCheckout,
        myPendingLeaves,
        myApprovedLeaves,
        myRejectedLeaves,
        thisMonthAttendance,
        upcomingLeaves
      ] = await Promise.all([
        User.findOne(buildTenantQuery(organization, {
          _id: req.user.id
        }))
          .select('leaveBalance')
          .lean(),
        AttendanceLog.findOne(buildTenantQuery(organization, {
          userId: req.user.id,
          type: 'checkin',
          timestamp: { $gte: todayStart, $lte: todayEnd }
        })).lean(),
        AttendanceLog.findOne(buildTenantQuery(organization, {
          userId: req.user.id,
          type: 'checkout',
          timestamp: { $gte: todayStart, $lte: todayEnd }
        })).lean(),
        LeaveRequest.countDocuments(buildTenantQuery(organization, {
          userId: req.user.id,
          status: 'pending'
        })),
        LeaveRequest.countDocuments(buildTenantQuery(organization, {
          userId: req.user.id,
          status: 'approved'
        })),
        LeaveRequest.countDocuments(buildTenantQuery(organization, {
          userId: req.user.id,
          status: 'rejected'
        })),
        AttendanceLog.distinct('timestamp', buildTenantQuery(organization, {
          userId: req.user.id,
          type: 'checkin',
          timestamp: { $gte: monthStart }
        })),
        LeaveRequest.countDocuments(buildTenantQuery(organization, {
          userId: req.user.id,
          status: 'approved',
          startDate: { $gte: todayStart }
        }))
      ]);

      const data = {
        attendance: {
          today: todayCheckin ? 1 : 0,
          checkedIn: Boolean(todayCheckin),
          checkedOut: Boolean(todayCheckout),
          thisMonth: thisMonthAttendance.length
        },
        leaves: {
          balance: user?.leaveBalance || 0,
          pending: myPendingLeaves,
          approved: myApprovedLeaves,
          rejected: myRejectedLeaves,
          upcoming: upcomingLeaves
        }
      };

      await cache.set(cacheKey, data, cache.CACHE_TTL.SHORT);

      return res.json({
        success: true,
        data
      });
    }

    let departmentUsers = null;
    let formQuery = buildTenantQuery(organization, {});
    let leaveQuery = buildTenantQuery(organization, {});
    let attendanceQuery = buildTenantQuery(organization, {
      type: 'checkin',
      timestamp: { $gte: todayStart, $lte: todayEnd }
    });
    let userQuery = buildTenantQuery(organization, { isActive: true });

    if (normalizedRole === 'supervisor') {
      const managedDepartments = getManagedDepartments(req.user);

      if (managedDepartments) {
        const departmentList = Array.from(managedDepartments);
        departmentUsers = await getOrganizationDepartmentUserIds(
          organization._id,
          departmentList
        );

        formQuery = {
          ...formQuery,
          department: { $in: departmentList }
        };
        leaveQuery = {
          ...leaveQuery,
          userId: { $in: departmentUsers }
        };
        attendanceQuery = {
          ...attendanceQuery,
          userId: { $in: departmentUsers }
        };
        userQuery = {
          ...userQuery,
          department: { $in: departmentList }
        };
      }
    }

    const upcomingWindowEnd = new Date(todayStart.getTime() + (7 * 24 * 60 * 60 * 1000));

    const [
      todayForms,
      thisWeekForms,
      pendingApprovals,
      todayAttendance,
      pendingLeaves,
      upcomingLeaves,
      totalUsers,
      recentForms
    ] = await Promise.all([
      FormInstance.countDocuments({
        ...formQuery,
        date: { $gte: todayStart, $lte: todayEnd }
      }),
      FormInstance.countDocuments({
        ...formQuery,
        date: { $gte: thisWeekStart }
      }),
      FormInstance.countDocuments({
        ...formQuery,
        status: 'submitted'
      }),
      AttendanceLog.countDocuments(attendanceQuery),
      LeaveRequest.countDocuments({
        ...leaveQuery,
        status: 'pending'
      }),
      LeaveRequest.countDocuments({
        ...leaveQuery,
        status: 'approved',
        startDate: { $gte: todayStart, $lte: upcomingWindowEnd }
      }),
      User.countDocuments(userQuery),
      FormInstance.find(formQuery)
        .populate('templateId', 'organizationId title')
        .populate('filledBy', 'organizationId name department')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
    ]);

    const data = {
      forms: {
        today: todayForms,
        thisWeek: thisWeekForms,
        pendingApprovals
      },
      attendance: {
        today: todayAttendance
      },
      leaves: {
        pending: pendingLeaves,
        upcoming: upcomingLeaves
      },
      users: {
        total: totalUsers
      },
      recentForms
    };

    await cache.set(cacheKey, data, cache.CACHE_TTL.SHORT);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
