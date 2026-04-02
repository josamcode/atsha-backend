const Task = require('../models/Task');
const { createNotification } = require('./notifications');

const TASK_NOTIFICATION_POPULATE = [
  {
    path: 'assignedBy',
    select: '_id organizationId name email role'
  },
  {
    path: 'assignedTo',
    select: '_id organizationId name email department role'
  }
];

const buildTaskOverdueTitle = () => ({
  en: 'Task Overdue',
  ar: 'المهمة تجاوزت موعدها'
});

const buildTaskOverdueMessage = (task) => {
  const employeeName = task.assignedTo?.name || 'Employee';
  const taskTitle = task.title || 'Task';

  return {
    en: `${employeeName} has not finished "${taskTitle}" yet`,
    ar: `${employeeName} لم يُنهِ المهمة "${taskTitle}" حتى الآن`
  };
};

const shouldMarkTaskOverdue = (task, now = new Date()) => {
  if (!task?.dueDate || task?.isOverdue) {
    return false;
  }

  if (['completed', 'rejected'].includes(task.status)) {
    return false;
  }

  return new Date(task.dueDate).getTime() <= now.getTime();
};

const ensureTaskNotificationData = async (task) => {
  if (!task) {
    return null;
  }

  const populatedTask = task;
  const needsPopulate = !populatedTask.assignedBy?.email || !populatedTask.assignedTo?.name;

  if (needsPopulate && typeof populatedTask.populate === 'function') {
    await populatedTask.populate(TASK_NOTIFICATION_POPULATE);
  }

  return populatedTask;
};

const markTaskOverdueIfNeeded = async (task, now = new Date()) => {
  if (!shouldMarkTaskOverdue(task, now)) {
    return task;
  }

  task.isOverdue = true;
  task.overdueNotifiedAt = task.overdueNotifiedAt || now;
  await task.save();

  const populatedTask = await ensureTaskNotificationData(task);

  if (populatedTask?.assignedBy?._id) {
    await createNotification({
      organizationId: populatedTask.organizationId,
      recipientIds: [populatedTask.assignedBy._id],
      type: 'task_overdue',
      title: buildTaskOverdueTitle(),
      message: buildTaskOverdueMessage(populatedTask),
      data: {
        taskId: populatedTask._id,
        assignedToId: populatedTask.assignedTo?._id || populatedTask.assignedTo,
        dueDate: populatedTask.dueDate ? populatedTask.dueDate.toISOString() : null,
        status: populatedTask.status,
        isOverdue: true
      }
    });
  }

  return populatedTask;
};

const syncOverdueTasksForOrganization = async (organization) => {
  if (!organization?._id) {
    return { updated: 0 };
  }

  const now = new Date();
  const overdueTasks = await Task.find({
    organizationId: organization._id,
    dueDate: { $lte: now },
    isOverdue: false,
    status: { $in: ['pending', 'accepted'] }
  }).populate(TASK_NOTIFICATION_POPULATE);

  for (const task of overdueTasks) {
    await markTaskOverdueIfNeeded(task, now);
  }

  return {
    updated: overdueTasks.length
  };
};

module.exports = {
  markTaskOverdueIfNeeded,
  shouldMarkTaskOverdue,
  syncOverdueTasksForOrganization
};
