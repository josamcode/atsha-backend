const express = require('express');
const router = express.Router();
const {
  getFormTemplates,
  getFormTemplate,
  createFormTemplate,
  updateFormTemplate,
  deleteFormTemplate,
  duplicateFormTemplate
} = require('../controllers/formTemplateController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getFormTemplates)
  .post(authorize('platform_admin', 'admin'), createFormTemplate);

router.route('/:id')
  .get(getFormTemplate)
  .put(authorize('platform_admin', 'admin'), updateFormTemplate)
  .delete(authorize('platform_admin', 'admin'), deleteFormTemplate);

router.post('/:id/duplicate', authorize('platform_admin', 'admin'), duplicateFormTemplate);

module.exports = router;

