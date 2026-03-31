const AuditLog = require('../models/AuditLog');
const { sendOrganizationAdminAuditEmails } = require('./auditEmailNotifications');

const getRequestIp = (req) => {
  const forwarded = req?.headers?.['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req?.ip || req?.socket?.remoteAddress || null;
};

const getUserAgent = (req) => req?.headers?.['user-agent'] || null;

const createAuditLog = async ({
  req,
  organizationId,
  actorUserId,
  action,
  entityType,
  entityId,
  metadata = {}
}) => {
  try {
    if (!actorUserId || !action || !entityType) {
      return null;
    }

    const auditLog = await AuditLog.create({
      organizationId: organizationId || req?.organization?._id || req?.user?.organizationId || null,
      actorUserId,
      action,
      entityType,
      entityId,
      metadata,
      ip: getRequestIp(req),
      userAgent: getUserAgent(req)
    });

    sendOrganizationAdminAuditEmails({ auditLog, req }).catch((error) => {
      console.error('Failed to queue organization admin audit email:', error);
    });

    return auditLog;
  } catch (error) {
    console.error('Failed to write audit log:', error);
    return null;
  }
};

module.exports = {
  createAuditLog
};
