const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Create a notification for organization admin users.
 * Pass organizationId to keep recipients isolated to one tenant.
 */
const createNotification = async ({ type, title, message, data = {}, organizationId = null }) => {
  try {
    const adminQuery = {
      isActive: true,
      role: { $in: ['admin', 'organization_admin'] }
    };

    if (organizationId) {
      adminQuery.organizationId = organizationId;
    }

    const adminUsers = await User.find(adminQuery).select('_id organizationId').lean();

    if (adminUsers.length === 0) {
      console.log('No admin users found to send notification');
      return;
    }

    const titleObj = typeof title === 'string'
      ? { en: title, ar: title }
      : { en: title.en || '', ar: title.ar || '' };

    const messageObj = typeof message === 'string'
      ? { en: message, ar: message }
      : { en: message.en || '', ar: message.ar || '' };

    const notifications = adminUsers.map((admin) => ({
      organizationId: organizationId || admin.organizationId || null,
      recipient: admin._id,
      type,
      title: titleObj,
      message: messageObj,
      data
    }));

    await Notification.insertMany(notifications);
    console.log(`Created ${notifications.length} notification(s) for admin recipients: ${type}`);
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

module.exports = {
  createNotification
};
