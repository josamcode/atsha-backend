# Query Optimization Checklist

## ✅ Completed Optimizations

### User Model
- [x] Removed `metadata` field (moved to UserMetadata collection)
- [x] Added comprehensive indexes
- [x] Kept essential fields only

### New Collections
- [x] Created `UserMetadata` collection for large data
- [x] Created `UserActivityLog` collection for activity logs
- [x] Added indexes to new collections

### Query Utilities
- [x] Created `userQueries.js` with optimized query methods
- [x] Created `userMetadata.js` for metadata operations
- [x] Defined projection constants for different use cases

### Controllers Updated
- [x] `userController.js` - All queries optimized
- [x] `authController.js` - User existence checks optimized
- [x] `checkAbsentUsers.js` - Uses lean() and projections

### Migration
- [x] Created migration script
- [x] Batch processing (100 users at a time)
- [x] Index creation
- [x] Verification steps

## 🔄 Remaining Optimizations

### Controllers to Update
- [ ] `formInstanceController.js` - Update User queries
- [ ] `leaveController.js` - Update User queries  
- [ ] `messageController.js` - Update User queries
- [ ] `attendanceController.js` - Verify all queries use projections
- [ ] `dashboard.js` - Update User queries

### Patterns to Apply

#### 1. Always Use Projections
```javascript
// ❌ Bad
const user = await User.findById(userId);

// ✅ Good
const user = await getUserById(userId, 'LIST');
// or
const user = await User.findById(userId).select('name email role');
```

#### 2. Use Lean() for Read-Only Queries
```javascript
// ✅ Good
const users = await User.find(query).select('name email').lean();
```

#### 3. Paginate Large Lists
```javascript
// ✅ Good
const { getUsers } = require('../utils/userQueries');
const users = await getUsers(query, 'LIST', { page: 1, limit: 20 });
```

#### 4. Use Utility Functions
```javascript
// ✅ Good
const { getUserById, searchUsers } = require('../utils/userQueries');
const user = await getUserById(userId, 'FULL');
```

## 📋 Quick Reference

### Common Projections
- `LIST` - For user lists (minimal fields)
- `BASIC` - Basic user info
- `FULL` - Full user (excludes password/tokens)
- `PROFILE` - For user profile pages
- `SEARCH` - For search/autocomplete
- `SCHEDULE` - For work schedule queries
- `LEAVE` - For leave balance queries

### Query Examples

#### Get User by ID
```javascript
const { getUserById } = require('../utils/userQueries');
const user = await getUserById(userId, 'FULL');
```

#### Get Users with Filters
```javascript
const { getUsers } = require('../utils/userQueries');
const users = await getUsers(
  { role: 'employee', isActive: true },
  'LIST',
  { page: 1, limit: 20, sort: { name: 1 } }
);
```

#### Search Users
```javascript
const { searchUsers } = require('../utils/userQueries');
const results = await searchUsers('john', { isActive: true }, 'SEARCH', 50);
```

#### Get User Metadata
```javascript
const { getUserMetadata } = require('../utils/userMetadata');
const metadata = await getUserMetadata(userId);
```

## 🚀 Performance Targets

- User document size: < 5KB (down from ~750KB)
- Query response time: < 50ms (down from 200-500ms)
- Network transfer: < 5KB per user (down from 750KB)
- All user lists: Paginated (20-50 per page)

## 📊 Monitoring

Check these regularly:
1. Average user document size
2. Query execution times
3. Index usage
4. Metadata collection growth

## 🔍 Verification

After migration, verify:
```javascript
// Check user document size
db.users.aggregate([
  { $project: { size: { $bsonSize: "$$ROOT" } } },
  { $group: { _id: null, avgSize: { $avg: "$size" } } }
]);

// Check indexes
db.users.getIndexes();

// Check metadata collection
db.usermetadatas.countDocuments();
```

