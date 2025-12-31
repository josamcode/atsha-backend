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

// Public route - validate QR token
router.get('/validate/:token', validateQRToken);

// Protected routes - require authentication
router.use(protect);

// Admin and QR Manager - QR code management
router.post('/qr/generate', authorize('admin', 'qr-manager'), generateQRCode);
router.get('/qr/current', authorize('admin', 'qr-manager'), getCurrentQR);
router.post('/qr/cleanup', authorize('admin'), cleanupExpiredQRs);
router.post('/check-absent', authorize('admin'), checkAbsentUsers);

// All authenticated users - record attendance
router.post('/record', recordAttendance);

// Get my attendance
router.get('/my-attendance', getMyAttendance);

// Admin and Supervisor - stats
router.get('/stats', authorize('admin', 'supervisor'), getAttendanceStats);

// All authenticated users - logs (employees can only see their own)
router.get('/logs', getAllAttendance);
router.get('/logs/grouped', getAllAttendanceGrouped);

// Admin only - update attendance log
router.put('/logs/:id', authorize('admin'), updateAttendanceLog);

module.exports = router;
