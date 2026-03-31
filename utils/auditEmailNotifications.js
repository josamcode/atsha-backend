const Organization = require('../models/Organization');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

const DEFAULT_ADMIN_ACTIVITY_EMAIL_SETTINGS = {
  enabled: true,
  categories: {
    users: true,
    invitations: true,
    forms: true,
    attendance: true,
    leaves: true,
    messages: true,
    organization: true,
    billing: true
  }
};

const CATEGORY_LABELS = {
  users: 'المستخدمون',
  invitations: 'الدعوات',
  forms: 'النماذج',
  attendance: 'الحضور',
  leaves: 'الإجازات',
  messages: 'الرسائل',
  organization: 'المنظمة',
  billing: 'الفوترة'
};

const ENTITY_LABELS = {
  user: 'مستخدم',
  invitation: 'دعوة',
  form_template: 'قالب نموذج',
  form_instance: 'نموذج',
  leave_request: 'طلب إجازة',
  attendance_token: 'رمز حضور',
  attendance_log: 'سجل حضور',
  message: 'رسالة',
  organization: 'منظمة'
};

const ACTION_LABELS = {
  'attendance_token.created': 'إنشاء رمز حضور',
  'attendance_log.updated': 'تحديث سجل حضور',
  'form_template.created': 'إنشاء قالب نموذج',
  'form_template.updated': 'تحديث قالب نموذج',
  'form_template.deleted': 'حذف قالب نموذج',
  'form_template.duplicated': 'نسخ قالب نموذج',
  'form_instance.created': 'إنشاء نموذج',
  'form_instance.submitted': 'إرسال نموذج',
  'form_instance.updated': 'تحديث نموذج',
  'form_instance.deleted': 'حذف نموذج',
  'form_instance.approved': 'الموافقة على نموذج',
  'form_instance.rejected': 'رفض نموذج',
  'invitation.created': 'إنشاء دعوة',
  'invitation.accepted': 'قبول دعوة',
  'invitation.cancelled': 'إلغاء دعوة',
  'organization.subscription_checkout_started': 'بدء اشتراك',
  'organization.subscription_payment_completed': 'إتمام دفع الاشتراك',
  'leave_request.created': 'إنشاء طلب إجازة',
  'leave_request.updated': 'تحديث طلب إجازة',
  'leave_request.deleted': 'حذف طلب إجازة',
  'leave_request.approved': 'الموافقة على طلب إجازة',
  'leave_request.rejected': 'رفض طلب إجازة',
  'leave_request.cancelled': 'إلغاء طلب إجازة',
  'message.broadcast_sent': 'إرسال رسالة جماعية',
  'message.sent': 'إرسال رسالة',
  'message.deleted': 'حذف رسالة',
  'organization.settings_updated': 'تحديث إعدادات المنظمة',
  'organization.branding_asset_updated': 'تحديث هوية المنظمة',
  'organization.created': 'إنشاء منظمة',
  'organization.updated': 'تحديث منظمة',
  'organization.status_changed': 'تغيير حالة المنظمة',
  'user.created': 'إنشاء مستخدم',
  'user.updated': 'تحديث مستخدم',
  'user.role_changed': 'تغيير دور مستخدم',
  'user.deleted': 'حذف مستخدم',
  'user.password_reset_by_admin': 'إعادة تعيين كلمة مرور مستخدم',
  'user.report_sent': 'إرسال تقرير مستخدم'
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const mergeEmailNotificationSettings = (settings) => ({
  enabled: settings?.enabled !== false,
  categories: {
    ...DEFAULT_ADMIN_ACTIVITY_EMAIL_SETTINGS.categories,
    ...(settings?.categories || {})
  }
});

const getAuditCategory = (action = '') => {
  if (typeof action !== 'string' || !action.trim()) {
    return null;
  }

  if (action.startsWith('user.')) return 'users';
  if (action.startsWith('invitation.')) return 'invitations';
  if (action.startsWith('form_template.') || action.startsWith('form_instance.')) return 'forms';
  if (action.startsWith('attendance_')) return 'attendance';
  if (action.startsWith('leave_request.')) return 'leaves';
  if (action.startsWith('message.')) return 'messages';
  if (action.startsWith('organization.subscription_')) return 'billing';
  if (action.startsWith('organization.')) return 'organization';

  return null;
};

const translateAuditAction = (action = '') => (
  ACTION_LABELS[action] || String(action || 'نشاط جديد')
);

const translateEntityType = (entityType = '') => (
  ENTITY_LABELS[entityType] || String(entityType || '--')
);

const formatActivityTime = (value, timezone) => {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'Africa/Cairo'
    }).format(new Date(value));
  } catch (error) {
    return new Date(value).toISOString();
  }
};

const buildActivityEmail = ({
  organizationName,
  actionLabel,
  categoryLabel,
  actorName,
  entityType,
  occurredAt
}) => {
  const safeOrganizationName = escapeHtml(organizationName || 'المنظمة');
  const safeActionLabel = escapeHtml(actionLabel || 'نشاط جديد');
  const safeCategoryLabel = escapeHtml(categoryLabel || 'عام');
  const safeActorName = escapeHtml(actorName || 'مستخدم غير معروف');
  const safeEntityType = escapeHtml(entityType || '--');
  const safeOccurredAt = escapeHtml(occurredAt || '--');
  const subject = `${organizationName || 'المنظمة'} | ${actionLabel || 'نشاط جديد'}`;

  return {
    subject,
    text: [
      `تنبيه نشاط للمنظمة: ${organizationName || 'المنظمة'}`,
      `الإجراء: ${actionLabel || 'نشاط جديد'}`,
      `الفئة: ${categoryLabel || 'عام'}`,
      `المنفذ: ${actorName || 'مستخدم غير معروف'}`,
      `الكيان: ${entityType || '--'}`,
      `الوقت: ${occurredAt || '--'}`
    ].join('\n'),
    html: `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeActionLabel}</title>
      </head>
      <body style="margin:0;padding:24px;background:#f3f4f6;font-family:'Cairo',Arial,sans-serif;color:#111827;direction:rtl;text-align:right;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
          <div style="padding:24px 28px;background:linear-gradient(135deg,#0f766e,#14b8a6);color:#ffffff;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;opacity:.85;">تنبيه نشاط المنظمة</p>
            <h1 style="margin:0;font-size:26px;line-height:1.2;">${safeOrganizationName}</h1>
          </div>
          <div style="padding:28px;">
            <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">
              تم تسجيل نشاط جديد يطابق إعدادات إشعارات البريد الإلكتروني لمديري المنظمة.
            </p>
            <div style="display:grid;gap:12px;">
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;">
                <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;color:#6b7280;">الإجراء</p>
                <p style="margin:0;font-size:18px;font-weight:700;color:#111827;">${safeActionLabel}</p>
              </div>
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
                <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>الفئة:</strong> ${safeCategoryLabel}</p>
                <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>المنفذ:</strong> ${safeActorName}</p>
                <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>الكيان:</strong> ${safeEntityType}</p>
                <p style="margin:0;font-size:14px;color:#374151;"><strong>الوقت:</strong> ${safeOccurredAt}</p>
              </div>
            </div>
            <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
              يمكنك تشغيل رسائل النشاط هذه أو إيقافها حسب الفئة من إعدادات المنظمة.
            </p>
          </div>
        </div>
      </body>
      </html>
    `
  };
};

const sendOrganizationAdminAuditEmails = async ({ auditLog, req }) => {
  try {
    const organizationId = auditLog?.organizationId || req?.organization?._id || req?.user?.organizationId || null;

    if (!organizationId) {
      return { success: false, skipped: 'missing_organization' };
    }

    const categoryKey = getAuditCategory(auditLog?.action);
    if (!categoryKey) {
      return { success: false, skipped: 'unsupported_action' };
    }

    const organization = await Organization.findById(organizationId)
      .select('name branding.displayName timezone emailNotificationSettings')
      .lean();

    if (!organization) {
      return { success: false, skipped: 'organization_not_found' };
    }

    const settings = mergeEmailNotificationSettings(organization.emailNotificationSettings);
    if (!settings.enabled || settings.categories[categoryKey] === false) {
      return { success: false, skipped: 'disabled' };
    }

    const recipients = await User.find({
      organizationId,
      isActive: true,
      role: { $in: ['organization_admin', 'admin'] },
      email: { $exists: true, $ne: '' }
    })
      .select('email')
      .lean();

    if (recipients.length === 0) {
      return { success: false, skipped: 'no_recipients' };
    }

    const organizationName = organization.branding?.displayName || organization.name || 'المنظمة';
    const actionLabel = translateAuditAction(auditLog?.action);
    const categoryLabel = CATEGORY_LABELS[categoryKey] || 'عام';
    const actorName = req?.user?.name || req?.user?.email || 'مستخدم غير معروف';
    const entityType = translateEntityType(auditLog?.entityType);
    const occurredAt = formatActivityTime(auditLog?.createdAt || new Date(), organization.timezone);
    const emailData = buildActivityEmail({
      organizationName,
      actionLabel,
      categoryLabel,
      actorName,
      entityType,
      occurredAt
    });

    const uniqueEmails = [...new Set(
      recipients
        .map((recipient) => String(recipient.email || '').trim().toLowerCase())
        .filter(Boolean)
    )];

    if (uniqueEmails.length === 0) {
      return { success: false, skipped: 'no_valid_emails' };
    }

    const results = await Promise.all(uniqueEmails.map((emailAddress) => (
      sendEmail({
        to: emailAddress,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text
      })
    )));

    return {
      success: true,
      total: uniqueEmails.length,
      sent: results.filter((result) => result?.success).length
    };
  } catch (error) {
    console.error('Failed to send organization admin audit emails:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOrganizationAdminAuditEmails
};
