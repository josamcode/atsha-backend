const express = require('express');
const billingController = require('../controllers/billingController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/callback', billingController.paymentCallback);
router.get('/error', billingController.paymentError);

router.use(protect);
router.use(authorize('organization_admin', 'platform_admin'));

router.get('/plans', billingController.listCheckoutPlans);
router.post('/checkout', billingController.checkout);
router.get('/status', billingController.getBillingStatus);
router.get('/history', billingController.getBillingHistory);

module.exports = router;
