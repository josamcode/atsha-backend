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

// Route for getting single user - accessible to all authenticated users (with restrictions in controller)
router.get('/:id', getUser);

// Protected routes (admin, supervisor only)
router.use(authorize('admin', 'supervisor'));

router.route('/')
  .get(getUsers)
  .post(authorize('admin'), upload.single('image'), createUser);

router.route('/:id')
  .put(authorize('admin'), upload.single('image'), updateUser)
  .delete(authorize('admin'), deleteUser);

router.put('/:id/reset-password', authorize('admin'), resetPassword);
router.get('/password-reset-requests', authorize('admin'), getPasswordResetRequests);
router.post('/:id/send-report', authorize('admin'), sendEmployeeReport);

module.exports = router;

