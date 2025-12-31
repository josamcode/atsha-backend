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
  .get(authorize('admin', 'supervisor'), getFormInstances)
  .post(authorize('admin', 'supervisor'), createFormInstance);

router.get('/stats/summary', authorize('admin', 'supervisor'), getFormStats);

router.route('/:id')
  .get(authorize('admin', 'supervisor'), getFormInstance)
  .put(authorize('admin', 'supervisor'), updateFormInstance)
  .delete(authorize('admin', 'supervisor'), deleteFormInstance);

router.put('/:id/approve', authorize('admin', 'supervisor'), approveFormInstance);
router.get('/:id/export', authorize('admin', 'supervisor'), exportFormInstance);

// Image upload routes
router.post('/:id/images', authorize('admin', 'supervisor'), upload.array('images', 10), uploadFormImages);
router.delete('/:id/images/:imageId', authorize('admin', 'supervisor'), deleteFormImage);

module.exports = router;

