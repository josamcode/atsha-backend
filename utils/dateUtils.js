/**
 * Date Utilities for Saudi Arabia Timezone (Asia/Riyadh, UTC+3)
 * All dates in the system should be handled using these utilities
 */

const SAUDI_TIMEZONE = 'Asia/Riyadh';
const SAUDI_OFFSET_HOURS = 3; // UTC+3

/**
 * Get current date/time in Saudi Arabia timezone
 * @returns {Date} Current date in Saudi timezone (as UTC Date object adjusted for Saudi time)
 */
function getNow() {
  return new Date();
}

/**
 * Get the start of today in Saudi Arabia timezone
 * @returns {Date} Start of today (00:00:00) in Saudi timezone
 */
function getStartOfToday() {
  const now = new Date();
  // Get current time in Saudi Arabia
  const saudiTime = new Date(now.toLocaleString('en-US', { timeZone: SAUDI_TIMEZONE }));
  // Set to start of day
  saudiTime.setHours(0, 0, 0, 0);
  // Convert back to UTC for database storage
  const utcTime = new Date(saudiTime.getTime() - (SAUDI_OFFSET_HOURS * 60 * 60 * 1000));
  return utcTime;
}

/**
 * Get the end of today in Saudi Arabia timezone
 * @returns {Date} End of today (23:59:59.999) in Saudi timezone
 */
function getEndOfToday() {
  const now = new Date();
  // Get current time in Saudi Arabia
  const saudiTime = new Date(now.toLocaleString('en-US', { timeZone: SAUDI_TIMEZONE }));
  // Set to end of day
  saudiTime.setHours(23, 59, 59, 999);
  // Convert back to UTC for database storage
  const utcTime = new Date(saudiTime.getTime() - (SAUDI_OFFSET_HOURS * 60 * 60 * 1000));
  return utcTime;
}

/**
 * Get start of a specific day in Saudi Arabia timezone
 * @param {Date|string} date - The date to get start of
 * @returns {Date} Start of the day in Saudi timezone
 */
function getStartOfDay(date) {
  const inputDate = new Date(date);
  // Get the date in Saudi Arabia timezone
  const saudiTime = new Date(inputDate.toLocaleString('en-US', { timeZone: SAUDI_TIMEZONE }));
  // Set to start of day
  saudiTime.setHours(0, 0, 0, 0);
  // Convert back to UTC for database storage
  const utcTime = new Date(saudiTime.getTime() - (SAUDI_OFFSET_HOURS * 60 * 60 * 1000));
  return utcTime;
}

/**
 * Get end of a specific day in Saudi Arabia timezone
 * @param {Date|string} date - The date to get end of
 * @returns {Date} End of the day in Saudi timezone
 */
function getEndOfDay(date) {
  const inputDate = new Date(date);
  // Get the date in Saudi Arabia timezone
  const saudiTime = new Date(inputDate.toLocaleString('en-US', { timeZone: SAUDI_TIMEZONE }));
  // Set to end of day
  saudiTime.setHours(23, 59, 59, 999);
  // Convert back to UTC for database storage
  const utcTime = new Date(saudiTime.getTime() - (SAUDI_OFFSET_HOURS * 60 * 60 * 1000));
  return utcTime;
}

/**
 * Format a date for display in Saudi Arabia timezone
 * @param {Date|string} date - The date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @param {string} locale - Locale string (default: 'en-SA')
 * @returns {string} Formatted date string
 */
function formatDate(date, options = {}, locale = 'en-SA') {
  const defaultOptions = {
    timeZone: SAUDI_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options
  };
  return new Date(date).toLocaleString(locale, defaultOptions);
}

/**
 * Format a date with time for display in Saudi Arabia timezone
 * @param {Date|string} date - The date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @param {string} locale - Locale string (default: 'en-SA')
 * @returns {string} Formatted date/time string
 */
function formatDateTime(date, options = {}, locale = 'en-SA') {
  const defaultOptions = {
    timeZone: SAUDI_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options
  };
  return new Date(date).toLocaleString(locale, defaultOptions);
}

/**
 * Format time only for display in Saudi Arabia timezone
 * @param {Date|string} date - The date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @param {string} locale - Locale string (default: 'en-SA')
 * @returns {string} Formatted time string
 */
function formatTime(date, options = {}, locale = 'en-SA') {
  const defaultOptions = {
    timeZone: SAUDI_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    ...options
  };
  return new Date(date).toLocaleTimeString(locale, defaultOptions);
}

/**
 * Get the day name in Saudi Arabia timezone
 * @param {Date|string} date - The date
 * @param {string} locale - Locale string (default: 'en-US')
 * @returns {string} Day name (lowercase)
 */
function getDayName(date, locale = 'en-US') {
  return new Date(date).toLocaleDateString(locale, {
    timeZone: SAUDI_TIMEZONE,
    weekday: 'long'
  }).toLowerCase();
}

/**
 * Get hours and minutes in Saudi Arabia timezone
 * @param {Date|string} date - The date
 * @returns {Object} { hours, minutes }
 */
function getTimeComponents(date) {
  const saudiTime = new Date(new Date(date).toLocaleString('en-US', { timeZone: SAUDI_TIMEZONE }));
  return {
    hours: saudiTime.getHours(),
    minutes: saudiTime.getMinutes(),
    seconds: saudiTime.getSeconds()
  };
}

/**
 * Get date components in Saudi Arabia timezone
 * @param {Date|string} date - The date
 * @returns {Object} { year, month, day, dayOfWeek }
 */
function getDateComponents(date) {
  const saudiTime = new Date(new Date(date).toLocaleString('en-US', { timeZone: SAUDI_TIMEZONE }));
  return {
    year: saudiTime.getFullYear(),
    month: saudiTime.getMonth(),
    day: saudiTime.getDate(),
    dayOfWeek: saudiTime.getDay()
  };
}

/**
 * Get YYYY-MM-DD string in Saudi Arabia timezone
 * @param {Date|string} date - The date
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getDateString(date) {
  const components = getDateComponents(date);
  const year = components.year;
  const month = String(components.month + 1).padStart(2, '0');
  const day = String(components.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date is today in Saudi Arabia timezone
 * @param {Date|string} date - The date to check
 * @returns {boolean}
 */
function isToday(date) {
  const todayString = getDateString(new Date());
  const dateString = getDateString(date);
  return todayString === dateString;
}

/**
 * Get N days ago from now in Saudi Arabia timezone
 * @param {number} days - Number of days ago
 * @returns {Date}
 */
function getDaysAgo(days) {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return now;
}

/**
 * Parse a date string and return a Date object
 * @param {string} dateString - The date string to parse
 * @returns {Date}
 */
function parseDate(dateString) {
  return new Date(dateString);
}

/**
 * Create a date in Saudi Arabia timezone from components
 * @param {number} year 
 * @param {number} month - 0-indexed month
 * @param {number} day 
 * @param {number} hours - optional
 * @param {number} minutes - optional
 * @param {number} seconds - optional
 * @returns {Date}
 */
function createDate(year, month, day, hours = 0, minutes = 0, seconds = 0) {
  // Create date in Saudi time
  const saudiTime = new Date(year, month, day, hours, minutes, seconds);
  // Convert to UTC for storage
  const utcTime = new Date(saudiTime.getTime() - (SAUDI_OFFSET_HOURS * 60 * 60 * 1000));
  return utcTime;
}

/**
 * Get the timezone name
 * @returns {string}
 */
function getTimezone() {
  return SAUDI_TIMEZONE;
}

/**
 * Get timezone offset in hours
 * @returns {number}
 */
function getTimezoneOffset() {
  return SAUDI_OFFSET_HOURS;
}

module.exports = {
  SAUDI_TIMEZONE,
  SAUDI_OFFSET_HOURS,
  getNow,
  getStartOfToday,
  getEndOfToday,
  getStartOfDay,
  getEndOfDay,
  formatDate,
  formatDateTime,
  formatTime,
  getDayName,
  getTimeComponents,
  getDateComponents,
  getDateString,
  isToday,
  getDaysAgo,
  parseDate,
  createDate,
  getTimezone,
  getTimezoneOffset
};
