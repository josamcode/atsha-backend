const dateUtils = require('./dateUtils');

// A checkout further than this from the last check-in is treated as unpaired.
const MAX_SHIFT_MS = 16 * 60 * 60 * 1000;

const toTime = (log) => new Date(log.timestamp).getTime();

const getShiftTime = (shift) => toTime(shift.checkin || shift.checkout);

const pairAttendanceLogs = (logs) => {
  const shifts = [];
  let currentShift = null;

  [...logs]
    .sort((a, b) => toTime(a) - toTime(b))
    .forEach((log) => {
      if (log.type === 'checkin') {
        currentShift = {
          date: dateUtils.getDateString(log.timestamp),
          checkin: log,
          checkout: null
        };
        shifts.push(currentShift);
        return;
      }

      if (currentShift && toTime(log) - toTime(currentShift.checkin) <= MAX_SHIFT_MS) {
        currentShift.checkout = log;
        return;
      }

      shifts.push({
        date: dateUtils.getDateString(log.timestamp),
        checkin: null,
        checkout: log
      });
    });

  return shifts;
};

module.exports = {
  MAX_SHIFT_MS,
  getShiftTime,
  pairAttendanceLogs
};
