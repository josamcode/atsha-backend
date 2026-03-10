const express = require('express');
const router = express.Router();
const {
  getCurrentOrganization,
  getCurrentOrganizationSettings,
  updateCurrentOrganizationSettings,
  listOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  updateOrganizationStatus
} = require('../controllers/organizationController');
const { protect, authorize } = require('../middleware/auth');
const resolveOrganization = require('../middleware/resolveOrganization');

router.use(resolveOrganization);
router.use(protect);

router.get('/current', getCurrentOrganization);
router.get('/current/settings', authorize('organization_admin', 'platform_admin'), getCurrentOrganizationSettings);
router.put('/current/settings', authorize('organization_admin', 'platform_admin'), updateCurrentOrganizationSettings);

router.get('/', authorize('platform_admin'), listOrganizations);
router.post('/', authorize('platform_admin'), createOrganization);
router.get('/:id', authorize('platform_admin'), getOrganizationById);
router.put('/:id', authorize('platform_admin'), updateOrganization);
router.patch('/:id/status', authorize('platform_admin'), updateOrganizationStatus);

module.exports = router;
