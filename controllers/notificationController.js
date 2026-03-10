const Notification = require('../models/Notification');
const { buildTenantQuery } = require('../utils/tenantScope');
const { resolveScopedOrganization } = require('../utils/formAccess');

const sendControllerError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.message
});

const parsePagination = (page, limit) => {
  const normalizedPage = Math.max(parseInt(page, 10) || 1, 1);
  const normalizedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit
  };
};

const resolveNotificationOrganization = async (req, fallbackOrganizationId = null) => (
  resolveScopedOrganization(req, fallbackOrganizationId)
);

// @desc    Get all notifications for current user
// @route   GET /api/notifications
// @access  Private
exports.getNotifications = async (req, res) => {
  try {
    const organization = await resolveNotificationOrganization(req);
    const { read, limit = 50, page = 1 } = req.query;
    const pagination = parsePagination(page, limit);
    const query = buildTenantQuery(organization, { recipient: req.user.id });

    if (read !== undefined) {
      query.read = read === 'true';
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .limit(pagination.limit)
        .skip(pagination.skip)
        .populate('recipient', 'organizationId name email'),
      Notification.countDocuments(query),
      Notification.countDocuments(buildTenantQuery(organization, {
        recipient: req.user.id,
        read: false
      }))
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        pages: Math.ceil(total / pagination.limit)
      },
      unreadCount
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get unread notifications count
// @route   GET /api/notifications/unread-count
// @access  Private
exports.getUnreadCount = async (req, res) => {
  try {
    const organization = await resolveNotificationOrganization(req);
    const count = await Notification.countDocuments(buildTenantQuery(organization, {
      recipient: req.user.id,
      read: false
    }));

    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
  try {
    const organization = await resolveNotificationOrganization(req);
    const notification = await Notification.findOne(buildTenantQuery(organization, {
      _id: req.params.id,
      recipient: req.user.id
    }));

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    notification.read = true;
    notification.readAt = new Date();
    await notification.save();

    res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
exports.markAllAsRead = async (req, res) => {
  try {
    const organization = await resolveNotificationOrganization(req);
    const result = await Notification.updateMany(
      buildTenantQuery(organization, {
        recipient: req.user.id,
        read: false
      }),
      {
        read: true,
        readAt: new Date()
      }
    );

    res.json({
      success: true,
      data: {
        updated: result.modifiedCount
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
exports.deleteNotification = async (req, res) => {
  try {
    const organization = await resolveNotificationOrganization(req);
    const notification = await Notification.findOneAndDelete(buildTenantQuery(organization, {
      _id: req.params.id,
      recipient: req.user.id
    }));

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      data: {}
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Delete all notifications
// @route   DELETE /api/notifications
// @access  Private
exports.deleteAllNotifications = async (req, res) => {
  try {
    const organization = await resolveNotificationOrganization(req);
    const result = await Notification.deleteMany(buildTenantQuery(organization, {
      recipient: req.user.id
    }));

    res.json({
      success: true,
      data: {
        deleted: result.deletedCount
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
