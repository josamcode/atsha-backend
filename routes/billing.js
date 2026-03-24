const express = require('express');
const billingController = require('../controllers/billingController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/callback', billingController.paymentCallback);
router.get('/error', billingController.paymentError);
router.get('/plans', billingController.listCheckoutPlans);

router.use(protect);
router.use(authorize('organization_admin', 'platform_admin'));

router.get('/admin/analytics', authorize('platform_admin'), billingController.getAdminPaymentsAnalytics);
router.get('/admin/payments', authorize('platform_admin'), billingController.getAdminPayments);
router.post('/checkout', billingController.checkout);
router.get('/status', billingController.getBillingStatus);
router.get('/history', billingController.getBillingHistory);

module.exports = router;
