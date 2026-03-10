const Message = require('../models/Message');
const User = require('../models/User');
const { attachOrganizationId, buildTenantQuery } = require('../utils/tenantScope');
const {
  createHttpError,
  resolveScopedOrganization
} = require('../utils/formAccess');
const { normalizeRole } = require('../utils/tenantConstants');

const MESSAGE_POPULATE = [
  {
    path: 'sender',
    select: 'organizationId name email department role'
  },
  {
    path: 'recipient',
    select: 'organizationId name email department role'
  }
];

const BROADCAST_ALLOWED_ROLES = new Set([
  'platform_admin',
  'organization_admin'
]);

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

const resolveMessageOrganization = async (req, fallbackOrganizationId = null) => (
  resolveScopedOrganization(req, fallbackOrganizationId)
);

const getOrganizationUserOrThrow = async (organizationId, userId) => {
  const user = await User.findOne({
    _id: userId,
    organizationId
  })
    .select('_id organizationId name email department role isActive')
    .lean();

  if (!user) {
    throw createHttpError(404, 'Recipient not found');
  }

  return user;
};

const ensureMessageOwnership = (message, userId) => {
  const senderId = message.sender?._id || message.sender;
  const recipientId = message.recipient?._id || message.recipient;

  if (
    String(senderId) !== String(userId) &&
    String(recipientId) !== String(userId)
  ) {
    throw createHttpError(403, 'You do not have permission to view this message');
  }
};

// @desc    Get all messages for current user (inbox)
// @route   GET /api/messages
// @access  Private
exports.getMessages = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const { read, limit = 50, page = 1 } = req.query;
    const pagination = parsePagination(page, limit);
    const query = buildTenantQuery(organization, { recipient: req.user.id });

    if (read !== undefined) {
      query.read = read === 'true';
    }

    const [messages, total, unreadCount] = await Promise.all([
      Message.find(query)
        .sort({ createdAt: -1 })
        .limit(pagination.limit)
        .skip(pagination.skip)
        .populate(MESSAGE_POPULATE),
      Message.countDocuments(query),
      Message.countDocuments(buildTenantQuery(organization, {
        recipient: req.user.id,
        read: false
      }))
    ]);

    res.json({
      success: true,
      data: messages,
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

// @desc    Get sent messages
// @route   GET /api/messages/sent
// @access  Private
exports.getSentMessages = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const { limit = 50, page = 1 } = req.query;
    const pagination = parsePagination(page, limit);
    const query = buildTenantQuery(organization, { sender: req.user.id });

    const [messages, total] = await Promise.all([
      Message.find(query)
        .sort({ createdAt: -1 })
        .limit(pagination.limit)
        .skip(pagination.skip)
        .populate(MESSAGE_POPULATE),
      Message.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: messages,
      pagination: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        pages: Math.ceil(total / pagination.limit)
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get conversation between two users
// @route   GET /api/messages/conversation/:userId
// @access  Private
exports.getConversation = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    await getOrganizationUserOrThrow(organization._id, userId);

    const messages = await Message.find(buildTenantQuery(organization, {
      $or: [
        { sender: req.user.id, recipient: userId },
        { sender: userId, recipient: req.user.id }
      ]
    }))
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500))
      .populate(MESSAGE_POPULATE);

    res.json({
      success: true,
      data: messages.reverse()
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get unread messages count
// @route   GET /api/messages/unread-count
// @access  Private
exports.getUnreadCount = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const count = await Message.countDocuments(buildTenantQuery(organization, {
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

// @desc    Get single message
// @route   GET /api/messages/:id
// @access  Private
exports.getMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id)
      .populate(MESSAGE_POPULATE);

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    await resolveMessageOrganization(req, message.organizationId);
    ensureMessageOwnership(message, req.user.id);

    const recipientId = message.recipient?._id || message.recipient;
    if (String(recipientId) === String(req.user.id) && !message.read) {
      message.read = true;
      message.readAt = new Date();
      await message.save();
    }

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Send message
// @route   POST /api/messages
// @access  Private
exports.sendMessage = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const {
      recipient,
      subject,
      content,
      isBroadcast,
      recipients
    } = req.body;

    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        message: 'Subject and content are required'
      });
    }

    const normalizedRole = normalizeRole(req.user.role);

    if (isBroadcast) {
      if (!BROADCAST_ALLOWED_ROLES.has(normalizedRole)) {
        throw createHttpError(403, 'Only organization admins can send broadcast messages');
      }

      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw createHttpError(400, 'Recipients are required for broadcast messages');
      }

      const uniqueRecipientIds = [...new Set(
        recipients
          .map((value) => String(value))
          .filter(Boolean)
      )];

      const recipientUsers = await User.find({
        organizationId: organization._id,
        _id: { $in: uniqueRecipientIds }
      })
        .select('_id organizationId name email department role')
        .lean();

      if (recipientUsers.length !== uniqueRecipientIds.length) {
        throw createHttpError(400, 'One or more recipients are invalid for this organization');
      }

      const messages = recipientUsers.map((recipientUser) => (
        attachOrganizationId({
          sender: req.user.id,
          recipient: recipientUser._id,
          subject,
          content,
          isBroadcast: true,
          broadcastRecipients: recipientUsers.map((user) => user._id)
        }, organization)
      ));

      const createdMessages = await Message.insertMany(messages);
      await Message.populate(createdMessages, MESSAGE_POPULATE);

      return res.status(201).json({
        success: true,
        data: createdMessages,
        count: createdMessages.length
      });
    }

    if (!recipient) {
      return res.status(400).json({
        success: false,
        message: 'Recipient is required'
      });
    }

    const recipientUser = await getOrganizationUserOrThrow(organization._id, recipient);

    if (
      normalizedRole === 'employee' &&
      normalizeRole(recipientUser.role) !== 'organization_admin'
    ) {
      throw createHttpError(403, 'Employees can only send messages to organization admins');
    }

    const message = await Message.create(attachOrganizationId({
      sender: req.user.id,
      recipient,
      subject,
      content
    }, organization));

    await message.populate(MESSAGE_POPULATE);

    res.status(201).json({
      success: true,
      data: message
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Mark message as read
// @route   PUT /api/messages/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const message = await Message.findOne(buildTenantQuery(organization, {
      _id: req.params.id,
      recipient: req.user.id
    }));

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    message.read = true;
    message.readAt = new Date();
    await message.save();

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Mark all messages as read
// @route   PUT /api/messages/read-all
// @access  Private
exports.markAllAsRead = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const result = await Message.updateMany(
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

// @desc    Delete message
// @route   DELETE /api/messages/:id
// @access  Private
exports.deleteMessage = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const message = await Message.findOne(buildTenantQuery(organization, {
      _id: req.params.id,
      $or: [
        { sender: req.user.id },
        { recipient: req.user.id }
      ]
    }));

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    await message.deleteOne();

    res.json({
      success: true,
      data: {}
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Delete all messages
// @route   DELETE /api/messages
// @access  Private
exports.deleteAllMessages = async (req, res) => {
  try {
    const organization = await resolveMessageOrganization(req);
    const result = await Message.deleteMany(buildTenantQuery(organization, {
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
