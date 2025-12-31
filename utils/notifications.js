const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Create a notification for admin users
 * @param {Object} options - Notification options
 * @param {String} options.type - Notification type
 * @param {Object} options.title - Notification title {en: string, ar: string}
 * @param {Object} options.message - Notification message {en: string, ar: string}
 * @param {Object} options.data - Additional data for the notification
 */
const createNotification = async ({ type, title, message, data = {} }) => {
  try {
    // Find all admin users
    const adminUsers = await User.find({ role: 'admin', isActive: true }).select('_id');

    if (adminUsers.length === 0) {
      console.log('No admin users found to send notification');
      return;
    }

    // Ensure title and message are objects with en and ar
    const titleObj = typeof title === 'string'
      ? { en: title, ar: title }
      : { en: title.en || '', ar: title.ar || '' };

    const messageObj = typeof message === 'string'
      ? { en: message, ar: message }
      : { en: message.en || '', ar: message.ar || '' };

    // Create notifications for all admins
    const notifications = adminUsers.map(admin => ({
      recipient: admin._id,
      type,
      title: titleObj,
      message: messageObj,
      data
    }));

    await Notification.insertMany(notifications);
    console.log(`✅ Created ${notifications.length} notification(s) for admins: ${type}`);
  } catch (error) {
    console.error('Error creating notification:', error);
    // Don't throw error to prevent breaking the main flow
  }
};

module.exports = {
  createNotification
};

