const FormTemplate = require('../models/FormTemplate');
const { createAuditLog } = require('../utils/auditLogger');
const { attachOrganizationId } = require('../utils/tenantScope');
const {
  createHttpError,
  getRequestedOrganizationId,
  getRoleVariants,
  getUserManagedDepartments,
  normalizeTemplateDepartments,
  normalizeTemplateRoles,
  resolveFormsOrganization,
  roleListIncludes,
  templateSupportsDepartment
} = require('../utils/formAccess');
const {
  annotateTemplatesWithSubscriptionAccess,
  assertTemplateCreationAvailable,
  assertTemplateUnlocked
} = require('../utils/subscription');
const { normalizeDepartmentCode, normalizeRole } = require('../utils/tenantConstants');
const {
  DOCUMENT_VERSION,
  SUPPORTED_DOCUMENT_VERSIONS
} = require('../utils/document/documentModel');

const DEFAULT_TEMPLATE_VISIBLE_ROLES = ['admin', 'supervisor', 'employee'];
const DEFAULT_TEMPLATE_EDITABLE_ROLES = ['admin', 'supervisor', 'employee'];

const isPlainObject = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && !(value instanceof Date);

const toPlain = (value) => {
  if (value && typeof value.toObject === 'function') {
    return value.toObject();
  }
  return value;
};

/**
 * Recursive merge used for `layout` and `pdfStyle` updates.
 *
 * The previous one-level spread meant that sending `pdfStyle: { header: {...} }`
 * REPLACED the whole `header` sub-document, resetting every property the client
 * did not happen to include back to its schema default. Arrays are replaced
 * wholesale on purpose — `socialLinks` and `columnWidths` are ordered lists, not
 * things to merge element-by-element.
 */
/** Keys a request body must never be able to reach through a recursive merge. */
const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const deepMergeConfig = (current, incoming) => {
  const base = toPlain(current);
  if (!isPlainObject(incoming)) {
    return incoming === undefined ? base : incoming;
  }
  const result = isPlainObject(base) ? { ...base } : {};
  Object.keys(incoming).forEach((key) => {
    if (UNSAFE_MERGE_KEYS.has(key)) {
      return;
    }
    const nextValue = incoming[key];
    if (isPlainObject(nextValue)) {
      result[key] = deepMergeConfig(result[key], nextValue);
      return;
    }
    result[key] = nextValue;
  });
  return result;
};

/**
 * Guard against a client that was built against a newer layout schema. Saving a
 * document this server cannot render would leave the template unopenable, so
 * reject it with an explicit, actionable message instead.
 */
const assertRenderableDocument = (documentValue) => {
  if (documentValue === undefined || documentValue === null) {
    return;
  }
  const version = Number(documentValue.version);
  if (Number.isFinite(version) && !SUPPORTED_DOCUMENT_VERSIONS.includes(version)) {
    throw createHttpError(
      400,
      `Unsupported document layout version ${version}. This server supports version(s) ${SUPPORTED_DOCUMENT_VERSIONS.join(', ')}. Please update the application.`
    );
  }
};

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

const getTemplateById = (templateId) => (
  FormTemplate.findById(templateId).populate('createdBy', 'name email department role')
);

// Exported for the persistence tests; not part of the HTTP surface.
exports.deepMergeConfig = deepMergeConfig;
exports.assertRenderableDocument = assertRenderableDocument;

const ensureTemplateReadAccess = (req, template) => {
  const normalizedRole = normalizeRole(req.user.role);

  if (normalizedRole === 'platform_admin' || normalizedRole === 'organization_admin') {
    return;
  }

  if (!roleListIncludes(template.visibleToRoles, req.user.role)) {
    throw createHttpError(403, 'You do not have access to this template');
  }

  if (normalizedRole === 'employee') {
    if (!templateSupportsDepartment(template, req.user.department)) {
      throw createHttpError(403, 'You do not have access to this template');
    }

    return;
  }

  if (normalizedRole === 'supervisor') {
    const managedDepartments = getUserManagedDepartments(req.user);

    if (!managedDepartments) {
      return;
    }

    const accessibleDepartments = template.departments || [];
    const hasTemplateAccess = accessibleDepartments.includes('all') || accessibleDepartments.some((department) => (
      managedDepartments.has(department)
    ));

    if (!hasTemplateAccess) {
      throw createHttpError(403, 'You do not have access to this template');
    }
  }
};

// @desc    Get all form templates
// @route   GET /api/form-templates
// @access  Private
exports.getFormTemplates = async (req, res) => {
  try {
    const normalizedRole = normalizeRole(req.user.role);
    const requestedOrganizationId = getRequestedOrganizationId(req);
    const isPlatformAdminGlobalScope = normalizedRole === 'platform_admin' && !requestedOrganizationId;
    const organization = isPlatformAdminGlobalScope
      ? null
      : await resolveFormsOrganization(req);
    const { isActive, department } = req.query;
    const query = {};

    if (organization?._id) {
      query.organizationId = organization._id;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (normalizedRole !== 'platform_admin' && normalizedRole !== 'organization_admin') {
      query.visibleToRoles = { $in: getRoleVariants(req.user.role) };
    }

    if (department) {
      const normalizedDepartment = normalizeDepartmentCode(department);

      if (normalizedRole !== 'platform_admin' && normalizedRole !== 'organization_admin') {
        const managedDepartments = getUserManagedDepartments(req.user);
        if (managedDepartments && !managedDepartments.has(normalizedDepartment)) {
          throw createHttpError(403, 'You do not have access to this department');
        }
      }

      query.departments = { $in: [normalizedDepartment, 'all'] };
    } else if (normalizedRole === 'supervisor' || normalizedRole === 'employee') {
      const managedDepartments = getUserManagedDepartments(req.user);

      if (managedDepartments) {
        query.departments = { $in: [...Array.from(managedDepartments), 'all'] };
      }
    }

    const templates = await FormTemplate.find(query)
      .populate('organizationId', 'name slug departments branding.displayName')
      .populate('createdBy', 'name email department role')
      .sort({ createdAt: -1 });

    if (isPlatformAdminGlobalScope) {
      return res.json({
        success: true,
        count: templates.length,
        data: templates
      });
    }

    const templatesWithAccess = await annotateTemplatesWithSubscriptionAccess(
      organization,
      templates
    );

    res.json({
      success: true,
      count: templatesWithAccess.length,
      data: templatesWithAccess
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Get single form template
// @route   GET /api/form-templates/:id
// @access  Private
exports.getFormTemplate = async (req, res) => {
  try {
    const template = await getTemplateById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    const organization = await resolveFormsOrganization(req, template.organizationId);
    ensureTemplateReadAccess(req, template);
    const [formattedTemplate] = await annotateTemplatesWithSubscriptionAccess(
      organization,
      [template]
    );

    res.json({
      success: true,
      data: formattedTemplate
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Create form template
// @route   POST /api/form-templates
// @access  Private (Platform Admin, Organization Admin)
exports.createFormTemplate = async (req, res) => {
  try {
    const organization = await resolveFormsOrganization(req);
    const {
      title,
      description,
      sections,
      visibleToRoles,
      editableByRoles,
      departments,
      requiresApproval,
      isActive,
      layout,
      pdfStyle,
      document: documentValue,
      layoutVersion
    } = req.body;

    await assertTemplateCreationAvailable(organization);
    assertRenderableDocument(documentValue);

    const template = await FormTemplate.create(attachOrganizationId({
      title,
      description,
      sections,
      visibleToRoles: normalizeTemplateRoles(
        visibleToRoles,
        DEFAULT_TEMPLATE_VISIBLE_ROLES
      ),
      editableByRoles: normalizeTemplateRoles(
        editableByRoles,
        DEFAULT_TEMPLATE_EDITABLE_ROLES
      ),
      departments: normalizeTemplateDepartments(
        departments,
        organization,
        { fallbackDepartments: ['all'], defaultAll: true }
      ),
      requiresApproval: requiresApproval !== undefined ? requiresApproval : true,
      isActive: isActive !== undefined ? isActive : true,
      layout: layout || {},
      pdfStyle: pdfStyle || {},
      document: documentValue || undefined,
      layoutVersion: documentValue ? DOCUMENT_VERSION : (layoutVersion || 1),
      createdBy: req.user.id
    }, organization));

    await template.populate('createdBy', 'name email department role');

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'form_template.created',
      entityType: 'form_template',
      entityId: template._id,
      metadata: {
        title: template.title?.en || template.title?.ar || 'Untitled form',
        departments: template.departments,
        requiresApproval: template.requiresApproval
      }
    });

    res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Update form template
// @route   PUT /api/form-templates/:id
// @access  Private (Platform Admin, Organization Admin)
exports.updateFormTemplate = async (req, res) => {
  try {
    const template = await getTemplateById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    const organization = await resolveFormsOrganization(req, template.organizationId);
    await assertTemplateUnlocked(organization, template);
    const {
      title,
      description,
      sections,
      visibleToRoles,
      editableByRoles,
      departments,
      requiresApproval,
      isActive,
      layout,
      pdfStyle,
      document: documentValue,
      layoutVersion
    } = req.body;

    assertRenderableDocument(documentValue);

    if (title !== undefined) template.title = title;
    if (description !== undefined) template.description = description;
    if (sections !== undefined) template.sections = sections;
    if (visibleToRoles !== undefined) {
      template.visibleToRoles = normalizeTemplateRoles(visibleToRoles, template.visibleToRoles);
    }
    if (editableByRoles !== undefined) {
      template.editableByRoles = normalizeTemplateRoles(editableByRoles, template.editableByRoles);
    }
    if (departments !== undefined) {
      template.departments = normalizeTemplateDepartments(
        departments,
        organization,
        { fallbackDepartments: template.departments, defaultAll: true }
      );
    }
    if (requiresApproval !== undefined) template.requiresApproval = requiresApproval;
    if (isActive !== undefined) template.isActive = isActive;
    if (layout !== undefined) {
      template.layout = deepMergeConfig(template.layout, layout || {});
    }
    if (pdfStyle !== undefined) {
      template.pdfStyle = deepMergeConfig(template.pdfStyle, pdfStyle || {});
    }
    if (documentValue !== undefined) {
      // The visual document is an ordered block list: a merge would resurrect
      // deleted blocks, so it is replaced wholesale.
      template.document = documentValue;
      template.layoutVersion = DOCUMENT_VERSION;
    } else if (layoutVersion !== undefined) {
      template.layoutVersion = layoutVersion;
    }

    await template.save();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'form_template.updated',
      entityType: 'form_template',
      entityId: template._id,
      metadata: {
        title: template.title?.en || template.title?.ar || 'Untitled form',
        departments: template.departments,
        requiresApproval: template.requiresApproval,
        isActive: template.isActive
      }
    });

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Delete form template
// @route   DELETE /api/form-templates/:id
// @access  Private (Platform Admin, Organization Admin)
exports.deleteFormTemplate = async (req, res) => {
  try {
    const template = await getTemplateById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    const organization = await resolveFormsOrganization(req, template.organizationId);

    await template.deleteOne();

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'form_template.deleted',
      entityType: 'form_template',
      entityId: template._id,
      metadata: {
        title: template.title?.en || template.title?.ar || 'Untitled form'
      }
    });

    res.json({
      success: true,
      message: 'Form template deleted successfully'
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};

// @desc    Duplicate form template
// @route   POST /api/form-templates/:id/duplicate
// @access  Private (Platform Admin, Organization Admin)
exports.duplicateFormTemplate = async (req, res) => {
  try {
    const originalTemplate = await getTemplateById(req.params.id);

    if (!originalTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    const organization = await resolveFormsOrganization(req, originalTemplate.organizationId);
    await assertTemplateCreationAvailable(organization);
    const duplicate = await FormTemplate.create(attachOrganizationId({
      title: {
        en: `${originalTemplate.title?.en || 'Template'} (Copy)`,
        ar: `${originalTemplate.title?.ar || originalTemplate.title?.en || 'Template'} (Copy)`
      },
      description: originalTemplate.description,
      sections: originalTemplate.sections,
      visibleToRoles: originalTemplate.visibleToRoles,
      editableByRoles: originalTemplate.editableByRoles,
      departments: originalTemplate.departments,
      requiresApproval: originalTemplate.requiresApproval,
      layout: originalTemplate.layout,
      pdfStyle: originalTemplate.pdfStyle,
      document: originalTemplate.document ? toPlain(originalTemplate.document) : undefined,
      layoutVersion: originalTemplate.layoutVersion,
      isActive: originalTemplate.isActive,
      createdBy: req.user.id
    }, organization));

    await duplicate.populate('createdBy', 'name email department role');

    await createAuditLog({
      req,
      organizationId: organization._id,
      actorUserId: req.user._id,
      action: 'form_template.duplicated',
      entityType: 'form_template',
      entityId: duplicate._id,
      metadata: {
        sourceTemplateId: originalTemplate._id,
        title: duplicate.title?.en || duplicate.title?.ar || 'Untitled form'
      }
    });

    res.status(201).json({
      success: true,
      data: duplicate
    });
  } catch (error) {
    sendControllerError(res, error);
  }
};
