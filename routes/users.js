const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  getAdminUser,
  getPasswordResetRequests,
  sendEmployeeReport
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

// Public route for all authenticated users (to get admin for messaging)
router.get('/admin', getAdminUser);
router.get('/password-reset-requests', authorize('platform_admin', 'admin'), getPasswordResetRequests);

router.route('/')
  .get(authorize('platform_admin', 'admin', 'supervisor'), getUsers)
  .post(authorize('platform_admin', 'admin'), upload.single('image'), createUser);

// Route for getting single user - accessible to all authenticated users (with restrictions in controller)
router.get('/:id', getUser);

router.route('/:id')
  .put(authorize('platform_admin', 'admin'), upload.single('image'), updateUser)
  .delete(authorize('platform_admin', 'admin'), deleteUser);

router.put('/:id/reset-password', authorize('platform_admin', 'admin'), resetPassword);
router.post('/:id/send-report', authorize('platform_admin', 'admin'), sendEmployeeReport);

module.exports = router;

