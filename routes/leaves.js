const express = require('express');
const router = express.Router();
const {
  getLeaveRequests,
  getLeaveRequest,
  createLeaveRequest,
  updateLeaveRequest,
  deleteLeaveRequest,
  approveLeaveRequest,
  cancelLeaveRequest,
  getLeaveStats,
  getMyLeaveBalance
} = require('../controllers/leaveController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.get('/my-balance', getMyLeaveBalance);
router.get('/stats/summary', authorize('admin', 'supervisor'), getLeaveStats);

router.route('/')
  .get(getLeaveRequests)
  .post(createLeaveRequest);

router.route('/:id')
  .get(getLeaveRequest)
  .put(updateLeaveRequest)
  .delete(deleteLeaveRequest);

router.put('/:id/approve', authorize('admin', 'supervisor'), approveLeaveRequest);
router.put('/:id/cancel', cancelLeaveRequest);

module.exports = router;

