const express = require('express');
const router = express.Router();
const {
  generateQRCode,
  getCurrentQR,
  validateQRToken,
  recordAttendance,
  getMyAttendance,
  getAttendanceStats,
  getAllAttendance,
  getAllAttendanceGrouped,
  cleanupExpiredQRs,
  checkAbsentUsers,
  updateAttendanceLog
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/auth');
const resolveOrganization = require('../middleware/resolveOrganization');

router.use(resolveOrganization);

// Public route - validate QR token
router.get('/validate/:token', validateQRToken);

// Protected routes - require authentication
router.use(protect);

// Admin and QR Manager - QR code management
router.post('/qr/generate', authorize('platform_admin', 'admin', 'qr-manager'), generateQRCode);
router.get('/qr/current', authorize('platform_admin', 'admin', 'qr-manager'), getCurrentQR);
router.post('/qr/cleanup', authorize('platform_admin', 'admin'), cleanupExpiredQRs);
router.post('/check-absent', authorize('platform_admin', 'admin'), checkAbsentUsers);

// All authenticated users - record attendance
router.post('/record', recordAttendance);

// Get my attendance
router.get('/my-attendance', getMyAttendance);

// Admin and Supervisor - stats
router.get('/stats', authorize('platform_admin', 'admin', 'supervisor'), getAttendanceStats);

// All authenticated users - logs (employees can only see their own)
router.get('/logs', getAllAttendance);
router.get('/logs/grouped', getAllAttendanceGrouped);

// Admin only - update attendance log
router.put('/logs/:id', authorize('platform_admin', 'admin'), updateAttendanceLog);

module.exports = router;
