const Message = require('../models/Message');
const User = require('../models/User');

// @desc    Get all messages for current user (inbox)
// @route   GET /api/messages
// @access  Private
exports.getMessages = async (req, res) => {
  try {
    const { read, limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { recipient: req.user.id };
    if (read !== undefined) {
      query.read = read === 'true';
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate('sender', 'name email department role')
      .populate('recipient', 'name email department role');

    const total = await Message.countDocuments(query);
    const unreadCount = await Message.countDocuments({
      recipient: req.user.id,
      read: false
    });

    res.json({
      success: true,
      data: messages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      unreadCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get sent messages
// @route   GET /api/messages/sent
// @access  Private
exports.getSentMessages = async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const messages = await Message.find({ sender: req.user.id })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate('sender', 'name email department role')
      .populate('recipient', 'name email department role');

    const total = await Message.countDocuments({ sender: req.user.id });

    res.json({
      success: true,
      data: messages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get conversation between two users
// @route   GET /api/messages/conversation/:userId
// @access  Private
exports.getConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    const messages = await Message.find({
      $or: [
        { sender: req.user.id, recipient: userId },
        { sender: userId, recipient: req.user.id }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('sender', 'name email department role')
      .populate('recipient', 'name email department role');

    res.json({
      success: true,
      data: messages.reverse() // Reverse to show oldest first
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get unread messages count
// @route   GET /api/messages/unread-count
// @access  Private
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Message.countDocuments({
      recipient: req.user.id,
      read: false
    });

    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single message
// @route   GET /api/messages/:id
// @access  Private
exports.getMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id)
      .populate('sender', 'name email department role')
      .populate('recipient', 'name email department role');

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is sender or recipient
    if (message.sender._id.toString() !== req.user.id &&
      message.recipient._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this message'
      });
    }

    // Mark as read if recipient
    if (message.recipient._id.toString() === req.user.id && !message.read) {
      message.read = true;
      message.readAt = new Date();
      await message.save();
    }

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Send message
// @route   POST /api/messages
// @access  Private
exports.sendMessage = async (req, res) => {
  try {
    const { recipient, subject, content, isBroadcast, recipients } = req.body;

    if (!subject || !content) {
      return res.status(400).json({
        success: false,
        message: 'Subject and content are required'
      });
    }

    // Check if sending to multiple recipients (admin only)
    if (isBroadcast && recipients && recipients.length > 0) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only admins can send broadcast messages'
        });
      }

      // Create message for each recipient
      const messages = recipients.map(recipientId => ({
        sender: req.user.id,
        recipient: recipientId,
        subject,
        content,
        isBroadcast: true,
        broadcastRecipients: recipients
      }));

      const createdMessages = await Message.insertMany(messages);

      // Populate sender and recipient
      await Message.populate(createdMessages, [
        { path: 'sender', select: 'name email department role' },
        { path: 'recipient', select: 'name email department role' }
      ]);

      res.status(201).json({
        success: true,
        data: createdMessages,
        count: createdMessages.length
      });
    } else {
      // Single recipient message
      if (!recipient) {
        return res.status(400).json({
          success: false,
          message: 'Recipient is required'
        });
      }

      // Check if recipient exists
      const recipientUser = await User.findById(recipient);
      if (!recipientUser) {
        return res.status(404).json({
          success: false,
          message: 'Recipient not found'
        });
      }

      // Employees can only send to admin
      if (req.user.role === 'employee' && recipientUser.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Employees can only send messages to admin'
        });
      }

      const message = await Message.create({
        sender: req.user.id,
        recipient,
        subject,
        content
      });

      await message.populate('sender', 'name email department role');
      await message.populate('recipient', 'name email department role');

      res.status(201).json({
        success: true,
        data: message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Mark message as read
// @route   PUT /api/messages/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
  try {
    const message = await Message.findOne({
      _id: req.params.id,
      recipient: req.user.id
    });

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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Mark all messages as read
// @route   PUT /api/messages/read-all
// @access  Private
exports.markAllAsRead = async (req, res) => {
  try {
    const result = await Message.updateMany(
      {
        recipient: req.user.id,
        read: false
      },
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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete message
// @route   DELETE /api/messages/:id
// @access  Private
exports.deleteMessage = async (req, res) => {
  try {
    const message = await Message.findOne({
      _id: req.params.id,
      $or: [
        { sender: req.user.id },
        { recipient: req.user.id }
      ]
    });

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
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete all messages
// @route   DELETE /api/messages
// @access  Private
exports.deleteAllMessages = async (req, res) => {
  try {
    const result = await Message.deleteMany({
      recipient: req.user.id
    });

    res.json({
      success: true,
      data: {
        deleted: result.deletedCount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

