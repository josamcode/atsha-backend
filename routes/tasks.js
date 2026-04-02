const express = require('express');
const router = express.Router();
const {
  getTasks,
  createTask,
  respondToTask,
  completeTask
} = require('../controllers/taskController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(authorize('platform_admin', 'organization_admin', 'employee'), getTasks)
  .post(authorize('platform_admin', 'organization_admin'), createTask);

router.put('/:id/respond', authorize('employee'), respondToTask);
router.put('/:id/complete', authorize('employee'), completeTask);

module.exports = router;
