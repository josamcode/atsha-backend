const FormInstance = require('../models/FormInstance');
const FormTemplate = require('../models/FormTemplate');
const { createNotification } = require('../utils/notifications');
const pdfGenerator = require('../utils/pdfGenerator');
const {
  sendEmailToAdmins,
  sendEmailToUser,
  getFormSubmittedEmail,
  getFormApprovedEmail,
  getFormRejectedEmail
} = require('../utils/emailService');
const { deleteStoredAsset, uploadFormImage } = require('../utils/mediaStorage');
const { createAuditLog } = require('../utils/auditLogger');
const { attachOrganizationId } = require('../utils/tenantScope');
const {
  createHttpError,
  ensureDepartmentAccess,
  getActiveDepartmentCodes,
  getUserManagedDepartments,
  resolveFormsOrganization,
  roleListIncludes,
  templateSupportsDepartment
} = require('../utils/formAccess');
const {
  normalizeDepartmentCode,
  normalizeRole
} = require('../utils/tenantConstants');

const FORM_INSTANCE_TEMPLATE_SUMMARY_SELECT = [
  'organizationId',
  'title',
  'description',
  'departments',
  'visibleToRoles',
  'editableByRoles',
  'requiresApproval',
  'isActive',
  'layout',
  'pdfStyle'
].join(' ');

const FORM_INSTANCE_TEMPLATE_DETAIL_SELECT = [
  FORM_INSTANCE_TEMPLATE_SUMMARY_SELECT,
  'sections'
].join(' ');

const FORM_INSTANCE_POPULATE_SUMMARY = [
  {
    path: 'templateId',
    select: FORM_INSTANCE_TEMPLATE_SUMMARY_SELECT
  },
  {
    path: 'filledBy',
    select: 'organizationId name email department languagePreference role'
  },
  {
    path: 'approvedBy',
    select: 'organizationId name email department languagePreference role'
  }
];

const FORM_INSTANCE_POPULATE_DETAIL = [
  {
    path: 'templateId',
    select: FORM_INSTANCE_TEMPLATE_DETAIL_SELECT
  },
  {
    path: 'filledBy',
    select: 'organizationId name email department languagePreference role'
  },
  {
    path: 'approvedBy',
    select: 'organizationId name email department languagePreference role'
  }
];

const sendControllerError = (res, error) => {
  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate field value entered'
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors).map((entry) => entry.message).join(', ')
    });
  }

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message
  });
};

const getFormInstanceById = (instanceId) => (
  FormInstance.findById(instanceId).populate(FORM_INSTANCE_POPULATE_DETAIL)
);

const populateFormInstance = async (instance) => instance.populate(FORM_INSTANCE_POPULATE_DETAIL);

const getTemplateById = (templateId, organizationId) => (
  FormTemplate.findOne({
    _id: templateId,
    organizationId
  })
);

const ensureTemplateAvailability = (req, template) => {
  if (!template) {
    throw createHttpError(404, 'Form template not found');
  }

  if (!template.isActive) {
    throw createHttpError(400, 'Form template is not active');
  }

  if (!roleListIncludes(template.editableByRoles, req.user.role)) {
    throw createHttpError(403, 'You do not have permission to fill this form');
  }
};

const resolveInstanceDepartment = ({ req, organization, template, requestedDepartment, fallbackDepartment = null }) => {
  const allowedDepartments = getActiveDepartmentCodes(organization);
  const normalizedDepartment = normalizeDepartmentCode(
    requestedDepartment || fallbackDepartment || req.user.department
  );

  if (!normalizedDepartment) {
    throw createHttpError(400, 'Department is required');
  }

  if (!allowedDepartments.has(normalizedDepartment)) {
    throw createHttpError(400, `Department "${normalizedDepartment}" is not configured for this organization`);
  }

  if (!templateSupportsDepartment(template, normalizedDepartment)) {
    throw createHttpError(400, 'This template is not available for the selected department');
  }

  ensureDepartmentAccess(req.user, normalizedDepartment, 'You do not have access to this department');

  return normalizedDepartment;
};

const ensureInstanceReadAccess = (req, instance) => {
  const normalizedRole = normalizeRole(req.user.role);
  const filledById = instance.filledBy?._id || instance.filledBy;

  if (normalizedRole === 'platform_admin' || normalizedRole === 'organization_admin') {
    return;
  }

  if (normalizedRole === 'supervisor') {
    ensureDepartmentAccess(req.user, instance.department, 'You do not have access to this form');
    return;
  }

  if (normalizedRole === 'employee') {
    if (String(filledById) !== String(req.user._id)) {
      throw createHttpError(403, 'You do not have access to this form');
    }

    return;
  }

  throw createHttpError(403, 'You do not have access to this form');
};

const ensureInstanceManageAccess = (req, instance, options = {}) => {
  const { allowEmployeeDraft = false } = options;
  const normalizedRole = normalizeRole(req.user.role);
  const filledById = instance.filledBy?._id || instance.filledBy;

  if (normalizedRole === 'platform_admin' || normalizedRole === 'organization_admin') {
    return;
  }

  if (normalizedRole === 'supervisor') {
    ensureDepartmentAccess(req.user, instance.department, 'You do not have permission to manage this form');
    return;
  }

  if (normalizedRole === 'employee' && allowEmployeeDraft) {
    if (String(filledById) !== String(req.user._id)) {
      throw createHttpError(403, 'You do not have permission to manage this form');
    }

    if (instance.status !== 'draft') {
      throw createHttpError(400, 'Only draft forms can be modified by the form owner');
    }

    return;
  }

  throw createHttpError(403, 'You do not have permission to manage this form');
};

const ensureInstanceApprovalAccess = (req, instance) => {
  const normalizedRole = normalizeRole(req.user.role);

  if (normalizedRole === 'platform_admin' || normalizedRole === 'organization_admin') {
    return;
  }

  if (normalizedRole === 'supervisor') {
    ensureDepartmentAccess(req.user, instance.department, 'You do not have access to approve forms from this department');
    return;
  }

  throw createHttpError(403, 'You do not have access to approve this form');
};

const deleteInstanceAssets = async (instance) => {
  const assets = [
    ...(instance.attachments || []).map((entry) => entry.path).filter(Boolean),
    ...(instance.images || []).map((entry) => entry.path).filter(Boolean)
  ];

  for (const assetPath of assets) {
    try {
      await deleteStoredAsset(assetPath);
    } catch (cleanupError) {
      console.error('Error deleting stored form asset:', cleanupError);
    }
  }
};

const sendSubmittedNotifications = async (instance, organization) => {
  const templateTitleEn = instance.templateId?.title?.en || 'Form';
  const templateTitleAr = instance.templateId?.title?.ar || 'Form';
  const userName = instance.filledBy?.name || 'User';

  await createNotification({
    organizationId: organization._id,
    type: 'form_submitted',
    title: {
      en: 'New Form Submitted',
      ar: 'تم إرسال نموذج جديد'
    },
    message: {
      en: `${userName} submitted a new form: ${templateTitleEn}`,
      ar: `${userName} أرسل نموذجاً جديداً: ${templateTitleAr}`
    },
    data: {
      formId: instance._id,
      templateId: instance.templateId?._id || instance.templateId,
      filledBy: instance.filledBy?._id || instance.filledBy,
      department: instance.department
    }
  });

  await sendEmailToAdmins(
    (language) => getFormSubmittedEmail({
      templateTitle: { en: templateTitleEn, ar: templateTitleAr },
      filledBy: instance.filledBy,
      department: instance.department,
      date: instance.date,
      shift: instance.shift
    }, language),
    null,
    organization._id
  );
};

const sendDecisionNotifications = async (instance, organization, status, notes) => {
  const templateTitleEn = instance.templateId?.title?.en || 'Form';
  const templateTitleAr = instance.templateId?.title?.ar || 'Form';
  const userName = instance.filledBy?.name || 'User';
  const action = status === 'approved' ? 'approved' : 'rejected';

  await createNotification({
    organizationId: organization._id,
    type: `form_${action}`,
    title: {
      en: `Form ${action === 'approved' ? 'Approved' : 'Rejected'}`,
      ar: action === 'approved' ? 'تمت الموافقة على النموذج' : 'تم رفض النموذج'
    },
    message: {
      en: `Form "${templateTitleEn}" filled by ${userName} has been ${action}`,
      ar: action === 'approved'
        ? `تمت الموافقة على النموذج "${templateTitleAr}" الذي ملأه ${userName}`
        : `تم رفض النموذج "${templateTitleAr}" الذي ملأه ${userName}`
    },
    data: {
      formId: instance._id,
      templateId: instance.templateId?._id || instance.templateId,
      filledBy: instance.filledBy?._id || instance.filledBy,
      approvedBy: instance.approvedBy?._id || instance.approvedBy,
      status
    }
  });

  if (!instance.filledBy?.email) {
    return;
  }

  const userLanguage = instance.filledBy.languagePreference || 'ar';

  if (status === 'approved') {
    await sendEmailToUser(
      instance.filledBy.email,
      (language) => getFormApprovedEmail({
        templateTitle: { en: templateTitleEn, ar: templateTitleAr },
        approvedBy: instance.approvedBy,
        approvalDate: instance.approvalDate
      }, language),
      userLanguage
    );

    return;
  }

  await sendEmailToUser(
    instance.filledBy.email,
    (language) => getFormRejectedEmail({
      templateTitle: { en: templateTitleEn, ar: templateTitleAr },
      rejectedBy: instance.approvedBy,
      rejectionDate: instance.approvalDate,
      rejectionNotes: notes || ''
    }, language),
    userLanguage
  );
};

// @desc    Get all form instances
// @route   GET /api/form-instances
// @access  Private
exports.getFormInstances = async (req, res) => {
  try {
    const organization = await resolveFormsOrganization(req);
    const { templateId, status, department, dateFrom, dateTo, filledBy } = req.query;
    const query = {
      organizationId: organization._id
    };
    const normalizedRole = normalizeRole(req.user.role);

    if (templateId) query.templateId = templateId;
    if (status) query.status = status;
    if (filledBy) query.filledBy = filledBy;

    if (dateFrom || dateTo) {
      query.date = {};
      if (dateFrom) query.date.$gte = new Date(dateFrom);
      if (dateTo) query.date.$lte = new Date(dateTo);
    }

    if (normalizedRole === 'employee') {
      if (filledBy && String(filledBy) !== String(req.user._id)) {
        throw createHttpError(403, 'You do not have access to other users forms');
      }

      query.filledBy = req.user._id;
    }

    if (department) {
      const normalizedDepartment = normalizeDepartmentCode(department);

      if (normalizedRole === 'supervisor' || normalizedRole === 'employee') {
        ensureDepartmentAccess(req.user, normalizedDepartment, 'You do not have access to this department');
      }

      query.department = normalizedDepartment;
    } else if (normalizedRole === 'supervisor') {
      const managedDepartments = getUserManagedDepartments(req.user);
      if (managedDepartments) {
        query.department = { $in: Array.from(managedDepartments) };
      }
    }

    const instances = await FormInstance.find(query)
      .populate(FORM_INSTANCE_POPULATE_SUMMARY)
      .sort({ date: -1, createdAt: -1 });

    res.json({
      success: true,
      count: instances.length,
      data: instances
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get single form instance
// @route   GET /api/form-instances/:id
// @access  Private
exports.getFormInstance = async (req, res) => {
  try {
    const instance = await getFormInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: 'Form instance not found'
      });
    }

    await resolveFormsOrganization(req, instance.organizationId);
    ensureInstanceReadAccess(req, instance);

    res.json({
      success: true,
      data: instance
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Create form instance
// @route   POST /api/form-instances
// @access  Private
exports.createFormInstance = async (req, res) => {
  try {
    const organization = await resolveFormsOrganization(req);
    const { templateId, department, date, shift, values, status } = req.body;

    if (!templateId) {
      return res.status(400).json({
        success: false,
        message: 'Template ID is required'
      });
    }

    const template = await getTemplateById(templateId, organization._id);
    ensureTemplateAvailability(req, template);

    const requestedStatus = status || 'draft';
    if (!['draft', 'submitted'].includes(requestedStatus)) {
      throw createHttpError(400, 'Status must be either draft or submitted when creating a form');
    }

    const resolvedDepartment = resolveInstanceDepartment({
      req,
      organization,
      template,
      requestedDepartment: department
    });

    const instance = await FormInstance.create(attachOrganizationId({
      templateId,
      filledBy: req.user.id,
      department: resolvedDepartment,
      date: date || Date.now(),
      shift: shift || 'morning',
      values: values || {},
      status: requestedStatus
    }, organization));

    await populateFormInstance(instance);

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'form_instance.created',
      entityType: 'form_instance',
      entityId: instance._id,
      metadata: {
        templateId,
        department: instance.department,
        status: instance.status
      }
    });

    if (instance.status === 'submitted') {
      await sendSubmittedNotifications(instance, organization);

      await createAuditLog({
        req,
        organizationId: organization._id,
        actorUserId: req.user._id,
        action: 'form_instance.submitted',
        entityType: 'form_instance',
        entityId: instance._id,
        metadata: {
          templateId,
          department: instance.department
        }
      });
    }

    res.status(201).json({
      success: true,
      data: instance
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Update form instance
// @route   PUT /api/form-instances/:id
// @access  Private
exports.updateFormInstance = async (req, res) => {
  try {
    const instance = await getFormInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: 'Form instance not found'
      });
    }

    const organization = await resolveFormsOrganization(req, instance.organizationId);
    ensureInstanceManageAccess(req, instance, { allowEmployeeDraft: true });

    if (['approved', 'rejected'].includes(instance.status)) {
      throw createHttpError(400, 'Approved or rejected forms cannot be edited');
    }

    const template = await getTemplateById(instance.templateId?._id || instance.templateId, organization._id);
    if (!template) {
      throw createHttpError(404, 'Form template not found');
    }

    if (!template.isActive) {
      throw createHttpError(400, 'Form template is not active');
    }

    if (
      normalizeRole(req.user.role) === 'employee' &&
      !roleListIncludes(template.editableByRoles, req.user.role)
    ) {
      throw createHttpError(403, 'You do not have permission to edit this form');
    }

    const previousStatus = instance.status;
    const nextStatus = req.body.status !== undefined ? req.body.status : instance.status;
    if (!['draft', 'submitted'].includes(nextStatus)) {
      throw createHttpError(400, 'Only draft and submitted statuses are allowed in this endpoint');
    }

    if (
      req.body.status !== undefined &&
      nextStatus !== instance.status &&
      !(instance.status === 'draft' && nextStatus === 'submitted')
    ) {
      throw createHttpError(400, 'Invalid form status transition');
    }

    if (req.body.department !== undefined) {
      instance.department = resolveInstanceDepartment({
        req,
        organization,
        template,
        requestedDepartment: req.body.department,
        fallbackDepartment: instance.department
      });
    }

    if (req.body.date !== undefined) instance.date = req.body.date;
    if (req.body.shift !== undefined) instance.shift = req.body.shift;
    if (req.body.values !== undefined) instance.values = req.body.values;
    if (req.body.status !== undefined) instance.status = nextStatus;

    await instance.save();
    await populateFormInstance(instance);

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'form_instance.updated',
      entityType: 'form_instance',
      entityId: instance._id,
      metadata: {
        templateId: instance.templateId?._id || instance.templateId,
        department: instance.department,
        status: instance.status
      }
    });

    if (previousStatus !== 'submitted' && instance.status === 'submitted') {
      await sendSubmittedNotifications(instance, organization);

      await createAuditLog({
        req,
        organizationId: organization._id,
        actorUserId: req.user._id,
        action: 'form_instance.submitted',
        entityType: 'form_instance',
        entityId: instance._id,
        metadata: {
          templateId: instance.templateId?._id || instance.templateId,
          department: instance.department
        }
      });
    }

    res.json({
      success: true,
      data: instance
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Delete form instance
// @route   DELETE /api/form-instances/:id
// @access  Private
exports.deleteFormInstance = async (req, res) => {
  try {
    const instance = await getFormInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: 'Form instance not found'
      });
    }

    const organization = await resolveFormsOrganization(req, instance.organizationId);
    ensureInstanceManageAccess(req, instance, { allowEmployeeDraft: true });

    await deleteInstanceAssets(instance);
    await instance.deleteOne();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'form_instance.deleted',
      entityType: 'form_instance',
      entityId: instance._id,
      metadata: {
        templateId: instance.templateId?._id || instance.templateId,
        department: instance.department,
        status: instance.status
      }
    });

    res.json({
      success: true,
      message: 'Form instance deleted successfully'
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Approve/Reject form instance
// @route   PUT /api/form-instances/:id/approve
// @access  Private (Platform Admin, Organization Admin, Supervisor)
exports.approveFormInstance = async (req, res) => {
  try {
    const { status, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either approved or rejected'
      });
    }

    const instance = await getFormInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: 'Form instance not found'
      });
    }

    const organization = await resolveFormsOrganization(req, instance.organizationId);
    ensureInstanceApprovalAccess(req, instance);

    if (!instance.templateId?.requiresApproval) {
      throw createHttpError(400, 'This form template does not require approval');
    }

    if (instance.status !== 'submitted') {
      throw createHttpError(400, 'Only submitted forms can be approved or rejected');
    }

    instance.status = status;
    instance.approvedBy = req.user.id;
    instance.approvalDate = Date.now();
    instance.approvalNotes = notes || '';

    await instance.save();
    await populateFormInstance(instance);
    await sendDecisionNotifications(instance, organization, status, notes);

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: `form_instance.${status}`,
      entityType: 'form_instance',
      entityId: instance._id,
      metadata: {
        templateId: instance.templateId?._id || instance.templateId,
        filledBy: instance.filledBy?._id || instance.filledBy,
        notes: notes || ''
      }
    });

    res.json({
      success: true,
      data: instance
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Export form instance as PDF
// @route   GET /api/form-instances/:id/export
// @access  Private
exports.exportFormInstance = async (req, res) => {
  try {
    const { language = 'en' } = req.query;
    const instance = await getFormInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: 'Form instance not found'
      });
    }

    const organization = await resolveFormsOrganization(req, instance.organizationId);
    ensureInstanceReadAccess(req, instance);

    const pdfBuffer = await pdfGenerator.generateFormPDF(
      instance,
      instance.templateId,
      instance.filledBy,
      language,
      { organization }
    );

    const filename = `form_${instance._id}_${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF Export Error:', error);
    sendControllerError(res, error);
  }
};

// @desc    Get form statistics
// @route   GET /api/form-instances/stats/summary
// @access  Private (Platform Admin, Organization Admin, Supervisor)
exports.getFormStats = async (req, res) => {
  try {
    const organization = await resolveFormsOrganization(req);
    const { dateFrom, dateTo, department } = req.query;
    const matchQuery = {
      organizationId: organization._id
    };
    const normalizedRole = normalizeRole(req.user.role);

    if (dateFrom || dateTo) {
      matchQuery.date = {};
      if (dateFrom) matchQuery.date.$gte = new Date(dateFrom);
      if (dateTo) matchQuery.date.$lte = new Date(dateTo);
    }

    if (department) {
      const normalizedDepartment = normalizeDepartmentCode(department);

      if (normalizedRole === 'supervisor') {
        ensureDepartmentAccess(req.user, normalizedDepartment, 'You do not have access to this department');
      }

      matchQuery.department = normalizedDepartment;
    } else if (normalizedRole === 'supervisor') {
      const managedDepartments = getUserManagedDepartments(req.user);
      if (managedDepartments) {
        matchQuery.department = { $in: Array.from(managedDepartments) };
      }
    }

    const [stats, totalForms, byDepartment] = await Promise.all([
      FormInstance.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      FormInstance.countDocuments(matchQuery),
      FormInstance.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$department',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        total: totalForms,
        byStatus: stats,
        byDepartment
      }
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Upload images to form instance
// @route   POST /api/form-instances/:id/images
// @access  Private (Platform Admin, Organization Admin, Supervisor)
exports.uploadFormImages = async (req, res) => {
  const uploadedImages = [];
  let imagesSaved = false;

  try {
    const formInstance = await FormInstance.findById(req.params.id);

    if (!formInstance) {
      return res.status(404).json({
        success: false,
        message: 'Form instance not found'
      });
    }

    const organization = await resolveFormsOrganization(req, formInstance.organizationId);
    ensureInstanceApprovalAccess(req, formInstance);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded'
      });
    }

    for (const file of req.files) {
      const uploadedImage = await uploadFormImage(
        file,
        organization._id.toString(),
        formInstance._id.toString()
      );

      uploadedImages.push({
        filename: file.originalname,
        path: uploadedImage.secure_url,
        mimetype: file.mimetype,
        size: file.size,
        uploadedAt: new Date()
      });
    }

    if (!formInstance.images) {
      formInstance.images = [];
    }

    formInstance.images.push(...uploadedImages);
    await formInstance.save();
    imagesSaved = true;

    res.json({
      success: true,
      message: 'Images uploaded successfully',
      data: uploadedImages
    });
  } catch (error) {
    if (!imagesSaved && uploadedImages.length > 0) {
      await Promise.all(uploadedImages.map(async (image) => {
        try {
          await deleteStoredAsset(image.path);
        } catch (cleanupError) {
          console.error('Error deleting uploaded form image after failure:', cleanupError);
        }
      }));
    }

    sendControllerError(res, error);
  }
};

// @desc    Delete image from form instance
// @route   DELETE /api/form-instances/:id/images/:imageId
// @access  Private (Platform Admin, Organization Admin, Supervisor)
exports.deleteFormImage = async (req, res) => {
  try {
    const formInstance = await FormInstance.findById(req.params.id);

    if (!formInstance) {
      return res.status(404).json({
        success: false,
        message: 'Form instance not found'
      });
    }

    await resolveFormsOrganization(req, formInstance.organizationId);
    ensureInstanceApprovalAccess(req, formInstance);

    const image = formInstance.images.id(req.params.imageId);

    if (!image) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    if (image.path) {
      try {
        await deleteStoredAsset(image.path);
      } catch (cleanupError) {
        console.error('Error deleting form image asset:', cleanupError);
      }
    }

    formInstance.images.pull(req.params.imageId);
    await formInstance.save();

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
