const AttendanceLog = require('../models/AttendanceLog');
const User = require('../models/User');
const { createNotification } = require('./notifications');
const dateUtils = require('./dateUtils');

/**
 * Check for absent users at the end of the day
 * This should be called daily (e.g., via cron job at end of day)
 * Uses Saudi Arabia timezone (Asia/Riyadh)
 */
const checkAbsentUsers = async () => {
  try {
    // Use Saudi Arabia timezone for today's check
    const todayStart = dateUtils.getStartOfToday();
    const todayEnd = dateUtils.getEndOfToday();

    // Get all active users (optimized - only select necessary fields)
    const activeUsers = await User.find({ isActive: true })
      .select('_id name email department workDays workSchedule')
      .lean(); // Use lean() for read-only queries

    // Get all check-ins for today
    const todayCheckins = await AttendanceLog.find({
      type: 'checkin',
      timestamp: {
        $gte: todayStart,
        $lte: todayEnd
      }
    }).select('userId');

    const checkedInUserIds = new Set(todayCheckins.map(log => log.userId.toString()));

    // Check each user
    for (const user of activeUsers) {
      if (!user.workDays || user.workDays.length === 0) {
        continue; // Skip users without work days
      }

      // Get day name in Saudi Arabia timezone
      const dayName = dateUtils.getDayName(new Date());

      // Check if today is a work day for this user
      if (!user.workDays.includes(dayName)) {
        continue; // Not a work day, skip
      }

      // Check if user checked in today
      if (!checkedInUserIds.has(user._id.toString())) {
        // User is absent
        await createNotification({
          type: 'user_absent',
          title: {
            en: 'Employee Absent',
            ar: 'غياب موظف'
          },
          message: {
            en: `${user.name} did not check in today`,
            ar: `${user.name} لم يسجل الحضور اليوم`
          },
          data: {
            userId: user._id,
            date: today.toISOString(),
            department: user.department
          }
        });
      }
    }

    console.log('✅ Absent users check completed');
  } catch (error) {
    console.error('Error checking absent users:', error);
  }
};

module.exports = {
  checkAbsentUsers
};

