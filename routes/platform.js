const express = require('express');
const router = express.Router();
const {
  getPlatformSettings,
  updatePlatformSettings,
  listSubscriptionPlans,
  createSubscriptionPlan,
  updateSubscriptionPlan
} = require('../controllers/platformController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('platform_admin'));

router.get('/settings', getPlatformSettings);
router.put('/settings', updatePlatformSettings);

router.route('/plans')
  .get(listSubscriptionPlans)
  .post(createSubscriptionPlan);

router.put('/plans/:code', updateSubscriptionPlan);

module.exports = router;
