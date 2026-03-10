const express = require('express');
const router = express.Router();
const {
  listInvitations,
  createInvitation,
  getInvitationPreview,
  acceptInvitation,
  cancelInvitation
} = require('../controllers/invitationController');
const { protect, authorize } = require('../middleware/auth');
const resolveOrganization = require('../middleware/resolveOrganization');

router.use(resolveOrganization);

router.get('/public/:token', getInvitationPreview);
router.post('/accept', acceptInvitation);

router.use(protect);

router.route('/')
  .get(authorize('organization_admin', 'platform_admin'), listInvitations)
  .post(authorize('organization_admin', 'platform_admin'), createInvitation);

router.put('/:id/cancel', authorize('organization_admin', 'platform_admin'), cancelInvitation);

module.exports = router;
