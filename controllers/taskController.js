const Task = require('../models/Task');
const User = require('../models/User');
const { createNotification } = require('../utils/notifications');
const {
  sendEmailToUser,
  getTaskAcceptedEmail,
  getTaskRejectedEmail,
  getTaskCompletedEmail
} = require('../utils/emailService');
const { attachOrganizationId, buildTenantQuery } = require('../utils/tenantScope');
const {
  createHttpError,
  resolveScopedOrganization
} = require('../utils/formAccess');
const { normalizeRole } = require('../utils/tenantConstants');
const { getEndOfDay } = require('../utils/dateUtils');
const {
  markTaskOverdueIfNeeded,
  syncOverdueTasksForOrganization
} = require('../utils/taskStatusSync');

const TASK_POPULATE = [
  {
    path: 'assignedBy',
    select: 'organizationId name email department role'
  },
  {
    path: 'assignedTo',
    select: 'organizationId name email department role'
  }
];

const TASK_CREATOR_ROLES = new Set([
  'platform_admin',
  'organization_admin'
]);

const TASK_ASSIGNEE_ROLES = new Set([
  'employee'
]);

const sendControllerError = (res, error) => res.status(error.statusCode || 500).json({
  success: false,
  message: error.message
});

const resolveTaskOrganization = async (req, fallbackOrganizationId = null) => (
  resolveScopedOrganization(req, fallbackOrganizationId)
);

const normalizeTaskString = (value, fieldName) => {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    throw createHttpError(400, `${fieldName} is required`);
  }

  return normalizedValue;
};

const parseOptionalDueDate = (value) => {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    throw createHttpError(400, 'Please provide a valid task due date');
  }

  return getEndOfDay(parsedDate);
};

const getTaskUserOrThrow = async (organizationId, userId) => {
  const user = await User.findOne({
    _id: userId,
    organizationId,
    isActive: true
  })
    .select('_id organizationId name email department role')
    .lean();

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
};

const ensureTaskViewAccess = (req, task) => {
  const normalizedRole = normalizeRole(req.user.role);

  if (TASK_CREATOR_ROLES.has(normalizedRole)) {
    return;
  }

  if (String(task.assignedTo?._id || task.assignedTo) !== String(req.user._id || req.user.id)) {
    throw createHttpError(403, 'You do not have access to this task');
  }
};

const buildTaskAssignedNotification = (task) => ({
  title: {
    en: 'New Task Assigned',
    ar: 'تم تعيين مهمة جديدة'
  },
  message: {
    en: `${task.assignedBy?.name || 'Admin'} assigned you "${task.title}"`,
    ar: `${task.assignedBy?.name || 'المدير'} عيّن لك المهمة "${task.title}"`
  }
});

const buildTaskCompletedNotification = (task) => ({
  title: {
    en: 'Task Completed',
    ar: 'تم إنجاز المهمة'
  },
  message: {
    en: `${task.assignedTo?.name || 'Employee'} completed "${task.title}"`,
    ar: `${task.assignedTo?.name || 'الموظف'} أنجز المهمة "${task.title}"`
  }
});

const buildTaskAcceptedNotification = (task) => ({
  title: {
    en: 'Task Accepted',
    ar: 'طھظ… ظ‚ط¨ظˆظ„ ط§ظ„ظ…ظ‡ظ…ط©'
  },
  message: {
    en: `${task.assignedTo?.name || 'Employee'} accepted "${task.title}"`,
    ar: `${task.assignedTo?.name || 'ط§ظ„ظ…ظˆط¸ظپ'} ظ‚ط¨ظ„ ط§ظ„ظ…ظ‡ظ…ط© "${task.title}"`
  }
});

const buildTaskRejectedNotification = (task) => ({
  title: {
    en: 'Task Rejected',
    ar: 'طھظ… ط±ظپط¶ ط§ظ„ظ…ظ‡ظ…ط©'
  },
  message: {
    en: `${task.assignedTo?.name || 'Employee'} rejected "${task.title}"`,
    ar: `${task.assignedTo?.name || 'ط§ظ„ظ…ظˆط¸ظپ'} ط±ظپط¶ ط§ظ„ظ…ظ‡ظ…ط© "${task.title}"`
  }
});

const applyTaskFilters = (query, { status, assignedTo, assignedBy, search }) => {
  if (status) {
    if (status === 'overdue') {
      query.status = { $in: ['pending', 'accepted'] };
      query.isOverdue = true;
    } else {
      query.status = status;
    }
  }

  if (assignedTo) {
    query.assignedTo = assignedTo;
  }

  if (assignedBy) {
    query.assignedBy = assignedBy;
  }

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { details: { $regex: search, $options: 'i' } }
    ];
  }

  return query;
};

// @desc    Get tasks for current organization
// @route   GET /api/tasks
// @access  Private
exports.getTasks = async (req, res) => {
  try {
    const organization = await resolveTaskOrganization(req);
    await syncOverdueTasksForOrganization(organization);

    const normalizedRole = normalizeRole(req.user.role);
    const query = TASK_CREATOR_ROLES.has(normalizedRole)
      ? buildTenantQuery(organization, {})
      : buildTenantQuery(organization, {
        assignedTo: req.user.id
      });

    applyTaskFilters(query, req.query);

    if (!TASK_CREATOR_ROLES.has(normalizedRole)) {
      delete query.assignedBy;
      delete query.assignedTo;
      query.assignedTo = req.user.id;
    }

    const tasks = await Task.find(query)
      .populate(TASK_POPULATE)
      .sort({ isOverdue: -1, dueDate: 1, createdAt: -1 });

    res.json({
      success: true,
      count: tasks.length,
      data: tasks
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Create task
// @route   POST /api/tasks
// @access  Private (Platform Admin, Organization Admin)
exports.createTask = async (req, res) => {
  try {
    const organization = await resolveTaskOrganization(req);
    const title = normalizeTaskString(req.body.title, 'Task title');
    const details = normalizeTaskString(req.body.details, 'Task details');
    const assignedToId = req.body.assignedTo || req.body.assignedToId;
    const dueDate = parseOptionalDueDate(req.body.dueDate);

    if (!assignedToId) {
      throw createHttpError(400, 'Assignee is required');
    }

    const assignee = await getTaskUserOrThrow(organization._id, assignedToId);
    const assigneeRole = normalizeRole(assignee.role);

    if (!TASK_ASSIGNEE_ROLES.has(assigneeRole)) {
      throw createHttpError(400, 'Tasks can only be assigned to employees');
    }

    const task = await Task.create(attachOrganizationId({
      assignedBy: req.user.id,
      assignedTo: assignee._id,
      title,
      details,
      dueDate
    }, organization));

    await task.populate(TASK_POPULATE);
    await markTaskOverdueIfNeeded(task);

    const assignedNotification = buildTaskAssignedNotification(task);

    await createNotification({
      organizationId: organization._id,
      recipientIds: [task.assignedTo?._id || task.assignedTo],
      type: 'task_assigned',
      title: assignedNotification.title,
      message: assignedNotification.message,
      data: {
        taskId: task._id,
        assignedById: task.assignedBy?._id || task.assignedBy,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
        status: task.status
      }
    });

    res.status(201).json({
      success: true,
      data: task
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Respond to task
// @route   PUT /api/tasks/:id/respond
// @access  Private
exports.respondToTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).populate(TASK_POPULATE);

    if (!task) {
      throw createHttpError(404, 'Task not found');
    }

    await resolveTaskOrganization(req, task.organizationId);
    ensureTaskViewAccess(req, task);
    await markTaskOverdueIfNeeded(task);

    if (String(task.assignedTo?._id || task.assignedTo) !== String(req.user._id || req.user.id)) {
      throw createHttpError(403, 'Only the assigned employee can respond to this task');
    }

    if (task.status !== 'pending') {
      throw createHttpError(400, 'This task has already been answered');
    }

    const requestedStatus = String(req.body.status || '').trim().toLowerCase();
    const requestedAction = String(req.body.action || '').trim().toLowerCase();
    const action = requestedAction || (
      requestedStatus === 'accepted'
        ? 'accept'
        : requestedStatus === 'rejected'
          ? 'reject'
          : ''
    );
    const notes = String(req.body.notes || '').trim();

    if (!['accept', 'reject'].includes(action)) {
      throw createHttpError(400, 'Task response must be either accept or reject');
    }

    if (action === 'reject' && !notes) {
      throw createHttpError(400, 'Please provide notes when rejecting a task');
    }

    task.status = action === 'accept' ? 'accepted' : 'rejected';
    task.responseNotes = notes;
    task.respondedAt = new Date();
    await task.save();
    await task.populate(TASK_POPULATE);

    if (task.assignedBy?.email) {
      const taskResponseEmail = action === 'accept'
        ? getTaskAcceptedEmail
        : getTaskRejectedEmail;

      await sendEmailToUser(
        task.assignedBy.email,
        (language) => taskResponseEmail({
          taskTitle: task.title,
          employeeName: task.assignedTo?.name || 'Employee',
          dueDate: task.dueDate,
          notes: task.responseNotes
        }, language)
      );
    }

    const taskResponseNotification = action === 'accept'
      ? buildTaskAcceptedNotification(task)
      : buildTaskRejectedNotification(task);

    await createNotification({
      organizationId: task.organizationId,
      recipientIds: [task.assignedBy?._id || task.assignedBy],
      type: action === 'accept' ? 'task_accepted' : 'task_rejected',
      title: taskResponseNotification.title,
      message: taskResponseNotification.message,
      data: {
        taskId: task._id,
        assignedToId: task.assignedTo?._id || task.assignedTo,
        respondedAt: task.respondedAt ? task.respondedAt.toISOString() : null,
        status: task.status,
        notes: task.responseNotes,
        isOverdue: task.isOverdue
      }
    });

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Complete task
// @route   PUT /api/tasks/:id/complete
// @access  Private
exports.completeTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).populate(TASK_POPULATE);

    if (!task) {
      throw createHttpError(404, 'Task not found');
    }

    await resolveTaskOrganization(req, task.organizationId);
    ensureTaskViewAccess(req, task);
    await markTaskOverdueIfNeeded(task);

    if (String(task.assignedTo?._id || task.assignedTo) !== String(req.user._id || req.user.id)) {
      throw createHttpError(403, 'Only the assigned employee can complete this task');
    }

    if (task.status !== 'accepted') {
      throw createHttpError(400, 'Only accepted tasks can be marked as completed');
    }

    task.status = 'completed';
    task.completionNotes = String(req.body.notes || '').trim();
    task.completedAt = new Date();
    await task.save();
    await task.populate(TASK_POPULATE);

    if (task.assignedBy?.email) {
      await sendEmailToUser(
        task.assignedBy.email,
        (language) => getTaskCompletedEmail({
          taskTitle: task.title,
          employeeName: task.assignedTo?.name || 'Employee',
          dueDate: task.dueDate,
          completedAt: task.completedAt,
          notes: task.completionNotes
        }, language)
      );
    }

    const completedNotification = buildTaskCompletedNotification(task);

    await createNotification({
      organizationId: task.organizationId,
      recipientIds: [task.assignedBy?._id || task.assignedBy],
      type: 'task_completed',
      title: completedNotification.title,
      message: completedNotification.message,
      data: {
        taskId: task._id,
        assignedToId: task.assignedTo?._id || task.assignedTo,
        completedAt: task.completedAt ? task.completedAt.toISOString() : null,
        status: task.status,
        isOverdue: task.isOverdue,
        notes: task.completionNotes
      }
    });

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
