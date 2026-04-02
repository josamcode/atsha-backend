const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Create notifications for specific recipients or fallback to organization admins.
 * Pass organizationId to keep recipients isolated to one tenant.
 */
const createNotification = async ({
  type,
  title,
  message,
  data = {},
  organizationId = null,
  recipientIds = []
}) => {
  try {
    const normalizedRecipientIds = [...new Set(
      (Array.isArray(recipientIds) ? recipientIds : [recipientIds])
        .filter(Boolean)
        .map((entry) => String(entry))
    )];

    let recipientUsers = [];

    if (normalizedRecipientIds.length > 0) {
      const recipientQuery = {
        _id: { $in: normalizedRecipientIds },
        isActive: true
      };

      if (organizationId) {
        recipientQuery.organizationId = organizationId;
      }

      recipientUsers = await User.find(recipientQuery).select('_id organizationId').lean();
    } else {
      const adminQuery = {
        isActive: true,
        role: { $in: ['admin', 'organization_admin'] }
      };

      if (organizationId) {
        adminQuery.organizationId = organizationId;
      }

      recipientUsers = await User.find(adminQuery).select('_id organizationId').lean();
    }

    if (recipientUsers.length === 0) {
      console.log('No recipients found to send notification');
      return;
    }

    const titleObj = typeof title === 'string'
      ? { en: title, ar: title }
      : { en: title.en || '', ar: title.ar || '' };

    const messageObj = typeof message === 'string'
      ? { en: message, ar: message }
      : { en: message.en || '', ar: message.ar || '' };

    const notifications = recipientUsers.map((recipientUser) => ({
      organizationId: organizationId || recipientUser.organizationId || null,
      recipient: recipientUser._id,
      type,
      title: titleObj,
      message: messageObj,
      data
    }));

    await Notification.insertMany(notifications);
    console.log(`Created ${notifications.length} notification(s) for recipients: ${type}`);
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

const createUserNotification = async ({
  recipientId,
  recipientIds = [],
  ...payload
}) => (
  createNotification({
    ...payload,
    recipientIds: recipientIds.length > 0 ? recipientIds : recipientId
  })
);

module.exports = {
  createNotification,
  createUserNotification
};
