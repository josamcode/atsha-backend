const express = require('express');
const router = express.Router();
const {
  getFormInstances,
  getFormInstance,
  createFormInstance,
  updateFormInstance,
  deleteFormInstance,
  approveFormInstance,
  exportFormInstance,
  getFormStats,
  uploadFormImages,
  deleteFormImage
} = require('../controllers/formInstanceController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

router.route('/')
  .get(authorize('platform_admin', 'admin', 'supervisor', 'employee'), getFormInstances)
  .post(authorize('platform_admin', 'admin', 'supervisor', 'employee'), upload.any(), createFormInstance);

router.get('/stats/summary', authorize('platform_admin', 'admin', 'supervisor'), getFormStats);

router.route('/:id')
  .get(authorize('platform_admin', 'admin', 'supervisor', 'employee'), getFormInstance)
  .put(authorize('platform_admin', 'admin', 'supervisor', 'employee'), upload.any(), updateFormInstance)
  .delete(authorize('platform_admin', 'admin', 'supervisor', 'employee'), deleteFormInstance);

router.put('/:id/approve', authorize('platform_admin', 'admin', 'supervisor'), approveFormInstance);
router.get('/:id/export', authorize('platform_admin', 'admin', 'supervisor', 'employee'), exportFormInstance);

// Image upload routes
router.post('/:id/images', authorize('platform_admin', 'admin', 'supervisor'), upload.array('images', 10), uploadFormImages);
router.delete('/:id/images/:imageId', authorize('platform_admin', 'admin', 'supervisor'), deleteFormImage);

module.exports = router;

