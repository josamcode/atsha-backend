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
  LIST: '_id organizationId name email role department departments isActive languagePreference image phone jobTitle',

  // Basic user info (most common)
  BASIC: '_id organizationId name email role department departments isActive languagePreference image phone jobTitle nationality idNumber createdAt',

  // Full user info (excluding sensitive fields)
  FULL: '-password -refreshToken -resetPasswordToken -resetPasswordExpire',

  // For authentication (needs password)
  AUTH: '+password +refreshToken',

  // For dashboard/user profile
  PROFILE: '_id organizationId name email role department departments isActive languagePreference image phone jobTitle nationality idNumber leaveBalance workDays workSchedule createdAt',

  // For search/autocomplete
  SEARCH: '_id organizationId name email role department',

  // For attendance/work schedule queries
  SCHEDULE: '_id organizationId name email workDays workSchedule department',

  // For leave balance queries
  LEAVE: '_id organizationId name email leaveBalance department',

  // For department filtering
  DEPARTMENT: '_id organizationId name email role department departments'
};

/**
 * Get user with optimized projection
 * @param {String|ObjectId} userId - User ID
 * @param {String} projection - Projection type from PROJECTIONS
 * @returns {Promise<User>}
 */
async function getUserById(userId, projection = 'FULL', filters = {}) {
  const fields = PROJECTIONS[projection] || PROJECTIONS.FULL;
  return await User.findOne({ _id: userId, ...filters }).select(fields);
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
async function getUserWithMetadata(userId, projection = 'FULL', includeMetadata = false, filters = {}) {
  const user = await getUserById(userId, projection, filters);

  if (!user) {
    return null;
  }

  const result = { user };

  if (includeMetadata) {
    const metadataQuery = { userId };

    if (filters.organizationId) {
      metadataQuery.organizationId = filters.organizationId;
    }

    const metadata = await UserMetadata.findOne(metadataQuery).lean();
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
async function searchUsers(searchTerm, filters = {}, projection = 'SEARCH', options = {}) {
  const fields = PROJECTIONS[projection] || PROJECTIONS.SEARCH;
  const normalizedOptions = typeof options === 'number'
    ? { limit: options }
    : (options || {});
  const query = {
    ...filters,
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { email: { $regex: searchTerm, $options: 'i' } }
    ]
  };

  let queryBuilder = User.find(query).select(fields);

  if (normalizedOptions.sort) {
    queryBuilder = queryBuilder.sort(normalizedOptions.sort);
  }

  if (normalizedOptions.skip) {
    queryBuilder = queryBuilder.skip(parseInt(normalizedOptions.skip, 10));
  }

  if (normalizedOptions.limit) {
    queryBuilder = queryBuilder.limit(parseInt(normalizedOptions.limit, 10));
  }

  return await queryBuilder.lean();
}

/**
 * Get users by department with pagination
 * @param {String|Array} departments - Department(s)
 * @param {Object} options - Pagination options
 * @param {String} projection - Projection type
 * @returns {Promise<Object>}
 */
async function getUsersByDepartment(departments, options = {}, projection = 'LIST') {
  const { page = 1, limit = 20, sort = { name: 1 }, organizationId } = options;
  const skip = (page - 1) * limit;
  const fields = PROJECTIONS[projection] || PROJECTIONS.LIST;

  const query = Array.isArray(departments)
    ? { department: { $in: departments }, isActive: true }
    : { department: departments, isActive: true };

  if (organizationId) {
    query.organizationId = organizationId;
  }

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

