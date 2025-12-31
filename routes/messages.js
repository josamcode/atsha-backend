const express = require('express');
const router = express.Router();
const {
  getMessages,
  getSentMessages,
  getConversation,
  getUnreadCount,
  getMessage,
  sendMessage,
  markAsRead,
  markAllAsRead,
  deleteMessage,
  deleteAllMessages
} = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

router.route('/')
  .get(getMessages)
  .post(sendMessage)
  .delete(deleteAllMessages);

router.get('/sent', getSentMessages);
router.get('/unread-count', getUnreadCount);
router.get('/conversation/:userId', getConversation);
router.put('/read-all', markAllAsRead);
router.get('/:id', getMessage);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteMessage);

module.exports = router;

