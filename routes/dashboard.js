const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const FormInstance = require('../models/FormInstance');
const LeaveRequest = require('../models/LeaveRequest');
const AttendanceLog = require('../models/AttendanceLog');
const User = require('../models/User');

const cache = require('../utils/cache');
const logger = require('../utils/logger');

// @desc    Get dashboard summary
// @route   GET /api/dashboard/summary
// @access  Private
router.get('/summary', protect, async (req, res) => {
  try {
    // Generate cache key based on user role and ID
    const cacheKey = cache.key('dashboard', req.user.role, req.user.id);
    
    // Try to get from cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());

    // Employee-specific data
    if (req.user.role === 'employee') {
      // Use Promise.all for parallel queries
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
        User.findById(req.user.id).select('leaveBalance').lean(),
        AttendanceLog.findOne({
          userId: req.user.id,
          type: 'checkin',
          timestamp: { $gte: today }
        }).lean(),
        AttendanceLog.findOne({
          userId: req.user.id,
          type: 'checkout',
          timestamp: { $gte: today }
        }).lean(),
        LeaveRequest.countDocuments({
          userId: req.user.id,
          status: 'pending'
        }),
        LeaveRequest.countDocuments({
          userId: req.user.id,
          status: 'approved'
        }),
        LeaveRequest.countDocuments({
          userId: req.user.id,
          status: 'rejected'
        }),
        AttendanceLog.distinct('timestamp', {
          userId: req.user.id,
          type: 'checkin',
          timestamp: { $gte: new Date(today.getFullYear(), today.getMonth(), 1) }
        }),
        LeaveRequest.countDocuments({
          userId: req.user.id,
          status: 'approved',
          startDate: { $gte: today }
        })
      ]);

      const data = {
        attendance: {
          today: todayCheckin ? 1 : 0,
          checkedIn: !!todayCheckin,
          checkedOut: !!todayCheckout,
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

      // Cache for 1 minute
      await cache.set(cacheKey, data, cache.CACHE_TTL.SHORT);

      return res.json({
        success: true,
        data
      });
    }

    // Admin/Supervisor data
    let query = {};
    let departmentUsers = null;

    // Department filter for supervisors
    if (req.user.role === 'supervisor') {
      query.department = { $in: req.user.departments };
      // Get department users once for reuse
      departmentUsers = await User.find({
        department: { $in: req.user.departments }
      }).select('_id').lean();
    }

    // Prepare queries for parallel execution
    const attendanceQuery = req.user.role === 'supervisor' && departmentUsers
      ? { userId: { $in: departmentUsers.map(u => u._id) }, type: 'checkin', timestamp: { $gte: today } }
      : { type: 'checkin', timestamp: { $gte: today } };

    const leaveQuery = req.user.role === 'supervisor' && departmentUsers
      ? { userId: { $in: departmentUsers.map(u => u._id) } }
      : {};

    const userQuery = req.user.role === 'supervisor'
      ? { department: { $in: req.user.departments }, isActive: true }
      : { isActive: true };

    // Execute all queries in parallel
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
      FormInstance.countDocuments({ ...query, date: { $gte: today } }),
      FormInstance.countDocuments({ ...query, date: { $gte: thisWeekStart } }),
      FormInstance.countDocuments({ ...query, status: 'submitted' }),
      AttendanceLog.countDocuments(attendanceQuery),
      LeaveRequest.countDocuments({ ...leaveQuery, status: 'pending' }),
      LeaveRequest.countDocuments({
        ...leaveQuery,
        status: 'approved',
        startDate: { $gte: today, $lte: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) }
      }),
      User.countDocuments(userQuery),
      FormInstance.find(query)
        .populate('templateId', 'title')
        .populate('filledBy', 'name department')
        .sort('-createdAt')
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

    // Cache for 1 minute
    await cache.set(cacheKey, data, cache.CACHE_TTL.SHORT);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

