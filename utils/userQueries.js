/**
 * User Query Utilities
 * Provides optimized query methods with proper field projections
 * to avoid loading large documents unnecessarily
 */

const User = require('../models/User');
const UserMetadata = require('../models/UserMetadata');

/**
 * Common field projections for different use cases
 */
const PROJECTIONS = {
  // Minimal fields for lists (fastest)
  LIST: '_id name email role department departments isActive languagePreference image phone jobTitle',

  // Basic user info (most common)
  BASIC: '_id name email role department departments isActive languagePreference image phone jobTitle nationality idNumber createdAt',

  // Full user info (excluding sensitive fields)
  FULL: '-password -refreshToken -resetPasswordToken -resetPasswordExpire',

  // For authentication (needs password)
  AUTH: '+password +refreshToken',

  // For dashboard/user profile
  PROFILE: '_id name email role department departments isActive languagePreference image phone jobTitle nationality idNumber leaveBalance workDays workSchedule createdAt',

  // For search/autocomplete
  SEARCH: '_id name email role department',

  // For attendance/work schedule queries
  SCHEDULE: '_id name email workDays workSchedule department',

  // For leave balance queries
  LEAVE: '_id name email leaveBalance department',

  // For department filtering
  DEPARTMENT: '_id name email role department departments'
};

/**
 * Get user with optimized projection
 * @param {String|ObjectId} userId - User ID
 * @param {String} projection - Projection type from PROJECTIONS
 * @returns {Promise<User>}
 */
async function getUserById(userId, projection = 'FULL') {
  const fields = PROJECTIONS[projection] || PROJECTIONS.FULL;
  return await User.findById(userId).select(fields);
}

/**
 * Get multiple users with optimized projection
 * @param {Object} query - MongoDB query
 * @param {String} projection - Projection type
 * @param {Object} options - Additional options (sort, limit, skip)
 * @returns {Promise<Array>}
 */
async function getUsers(query = {}, projection = 'LIST', options = {}) {
  const fields = PROJECTIONS[projection] || PROJECTIONS.LIST;
  let queryBuilder = User.find(query).select(fields);

  if (options.sort) {
    queryBuilder = queryBuilder.sort(options.sort);
  }

  if (options.limit) {
    queryBuilder = queryBuilder.limit(parseInt(options.limit));
  }

  if (options.skip) {
    queryBuilder = queryBuilder.skip(parseInt(options.skip));
  }

  return await queryBuilder.exec();
}

/**
 * Get user count with query
 * @param {Object} query - MongoDB query
 * @returns {Promise<Number>}
 */
async function getUserCount(query = {}) {
  return await User.countDocuments(query);
}

/**
 * Get user with metadata (if needed)
 * @param {String|ObjectId} userId - User ID
 * @param {String} projection - User projection type
 * @param {Boolean} includeMetadata - Whether to include metadata
 * @returns {Promise<Object>}
 */
async function getUserWithMetadata(userId, projection = 'FULL', includeMetadata = false) {
  const user = await getUserById(userId, projection);

  if (!user) {
    return null;
  }

  const result = { user };

  if (includeMetadata) {
    const metadata = await UserMetadata.findOne({ userId }).lean();
    result.metadata = metadata || null;
  }

  return result;
}

/**
 * Search users by name or email
 * @param {String} searchTerm - Search term
 * @param {Object} filters - Additional filters
 * @param {String} projection - Projection type
 * @param {Number} limit - Result limit
 * @returns {Promise<Array>}
 */
async function searchUsers(searchTerm, filters = {}, projection = 'SEARCH', limit = 50) {
  const fields = PROJECTIONS[projection] || PROJECTIONS.SEARCH;
  const query = {
    ...filters,
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { email: { $regex: searchTerm, $options: 'i' } }
    ]
  };

  return await User.find(query)
    .select(fields)
    .limit(limit)
    .lean(); // Use lean() for read-only queries (faster)
}

/**
 * Get users by department with pagination
 * @param {String|Array} departments - Department(s)
 * @param {Object} options - Pagination options
 * @param {String} projection - Projection type
 * @returns {Promise<Object>}
 */
async function getUsersByDepartment(departments, options = {}, projection = 'LIST') {
  const { page = 1, limit = 20, sort = { name: 1 } } = options;
  const skip = (page - 1) * limit;
  const fields = PROJECTIONS[projection] || PROJECTIONS.LIST;

  const query = Array.isArray(departments)
    ? { department: { $in: departments }, isActive: true }
    : { department: departments, isActive: true };

  const [users, total] = await Promise.all([
    User.find(query)
      .select(fields)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(query)
  ]);

  return {
    users,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
}

module.exports = {
  PROJECTIONS,
  getUserById,
  getUsers,
  getUserCount,
  getUserWithMetadata,
  searchUsers,
  getUsersByDepartment
};

