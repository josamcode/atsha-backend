const express = require('express');
const router = express.Router();
const {
  getOrganizationContext,
  register,
  sendOrganizationRegistrationVerificationCode,
  verifyOrganizationRegistrationEmail,
  registerOrganization,
  login,
  refreshToken,
  logout,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  requestPasswordReset
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const resolveOrganization = require('../middleware/resolveOrganization');
const requireOrganization = require('../middleware/requireOrganization');

router.use(resolveOrganization);

router.get('/organization', requireOrganization, getOrganizationContext);
router.post('/register', requireOrganization, register);
router.post('/register-organization/send-verification-code', sendOrganizationRegistrationVerificationCode);
router.post('/register-organization/verify-email', verifyOrganizationRegistrationEmail);
router.post('/register-organization', registerOrganization);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.post('/request-password-reset', requestPasswordReset);

module.exports = router;

