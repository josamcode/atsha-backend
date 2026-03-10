const AttendanceLog = require('../models/AttendanceLog');
const User = require('../models/User');
const { createNotification } = require('./notifications');
const dateUtils = require('./dateUtils');

/**
 * Check for absent users at the end of the day.
 * When organizationId is provided, the check is limited to that tenant.
 */
const checkAbsentUsers = async ({ organizationId = null } = {}) => {
  try {
    const todayStart = dateUtils.getStartOfToday();
    const todayEnd = dateUtils.getEndOfToday();
    const todayIso = todayStart.toISOString();
    const dayName = dateUtils.getDayName(new Date());

    const userQuery = { isActive: true };
    if (organizationId) {
      userQuery.organizationId = organizationId;
    }

    const activeUsers = await User.find(userQuery)
      .select('_id organizationId name department workDays')
      .lean();

    if (activeUsers.length === 0) {
      return {
        checkedUsers: 0,
        absentUsers: 0
      };
    }

    const checkinQuery = {
      type: 'checkin',
      timestamp: {
        $gte: todayStart,
        $lte: todayEnd
      }
    };

    if (organizationId) {
      checkinQuery.organizationId = organizationId;
    }

    const todayCheckins = await AttendanceLog.find(checkinQuery)
      .select('userId')
      .lean();

    const checkedInUserIds = new Set(
      todayCheckins.map((log) => String(log.userId))
    );

    let absentUsers = 0;

    for (const user of activeUsers) {
      if (!Array.isArray(user.workDays) || user.workDays.length === 0) {
        continue;
      }

      if (!user.workDays.includes(dayName)) {
        continue;
      }

      if (checkedInUserIds.has(String(user._id))) {
        continue;
      }

      absentUsers += 1;

      await createNotification({
        organizationId: user.organizationId || organizationId || null,
        type: 'user_absent',
        title: {
          en: 'Employee Absent',
          ar: 'ط؛ظٹط§ط¨ ظ…ظˆط¸ظپ'
        },
        message: {
          en: `${user.name} did not check in today`,
          ar: `${user.name} ظ„ظ… ظٹط³ط¬ظ„ ط§ظ„ط­ط¶ظˆط± ط§ظ„ظٹظˆظ…`
        },
        data: {
          userId: user._id,
          date: todayIso,
          department: user.department
        }
      });
    }

    console.log('Absent users check completed');

    return {
      checkedUsers: activeUsers.length,
      absentUsers
    };
  } catch (error) {
    console.error('Error checking absent users:', error);
    throw error;
  }
};

module.exports = {
  checkAbsentUsers
};
