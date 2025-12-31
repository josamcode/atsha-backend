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
  .post(authorize('admin'), createFormTemplate);

router.route('/:id')
  .get(getFormTemplate)
  .put(authorize('admin'), updateFormTemplate)
  .delete(authorize('admin'), deleteFormTemplate);

router.post('/:id/duplicate', authorize('admin'), duplicateFormTemplate);

module.exports = router;

