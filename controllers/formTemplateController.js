const FormTemplate = require('../models/FormTemplate');

// @desc    Get all form templates
// @route   GET /api/form-templates
// @access  Private
exports.getFormTemplates = async (req, res) => {
  try {
    const { isActive, department } = req.query;

    let query = {};

    // Filter by active status
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Filter by department
    if (department) {
      query.departments = { $in: [department, 'all'] };
    }

    // Filter by role visibility
    query.visibleToRoles = req.user.role;

    const templates = await FormTemplate.find(query)
      .populate('createdBy', 'name email')
      .sort('-createdAt');

    res.json({
      success: true,
      count: templates.length,
      data: templates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single form template
// @route   GET /api/form-templates/:id
// @access  Private
exports.getFormTemplate = async (req, res) => {
  try {
    const template = await FormTemplate.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    // Check if user has access to this template
    if (!template.visibleToRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this template'
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create form template
// @route   POST /api/form-templates
// @access  Private (Admin only)
exports.createFormTemplate = async (req, res) => {
  try {
    // Only management department admins can create templates
    if (req.user.role !== 'admin' || req.user.department !== 'management') {
      return res.status(403).json({
        success: false,
        message: 'Only management department admins can create form templates'
      });
    }

    const {
      title,
      description,
      sections,
      visibleToRoles,
      editableByRoles,
      departments,
      requiresApproval,
      layout,
      pdfStyle
    } = req.body;

    const template = await FormTemplate.create({
      title,
      description,
      sections,
      visibleToRoles: visibleToRoles || ['admin', 'supervisor', 'employee'],
      editableByRoles: editableByRoles || ['admin', 'supervisor', 'employee'],
      departments: departments || ['all'],
      requiresApproval: requiresApproval !== undefined ? requiresApproval : true,
      layout: layout || {},
      pdfStyle: pdfStyle || {},
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update form template
// @route   PUT /api/form-templates/:id
// @access  Private (Admin only)
exports.updateFormTemplate = async (req, res) => {
  try {
    // Only management department admins can update templates
    if (req.user.role !== 'admin' || req.user.department !== 'management') {
      return res.status(403).json({
        success: false,
        message: 'Only management department admins can update form templates'
      });
    }

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
      pdfStyle
    } = req.body;

    let template = await FormTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    // Update fields
    if (title) template.title = title;
    if (description !== undefined) template.description = description;
    if (sections) template.sections = sections;
    if (visibleToRoles) template.visibleToRoles = visibleToRoles;
    if (editableByRoles) template.editableByRoles = editableByRoles;
    if (departments) template.departments = departments;
    if (requiresApproval !== undefined) template.requiresApproval = requiresApproval;
    if (isActive !== undefined) template.isActive = isActive;
    if (layout) template.layout = { ...template.layout, ...layout };
    if (pdfStyle) template.pdfStyle = { ...template.pdfStyle, ...pdfStyle };

    await template.save();

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete form template
// @route   DELETE /api/form-templates/:id
// @access  Private (Admin only)
exports.deleteFormTemplate = async (req, res) => {
  try {
    // Only management department admins can delete templates
    if (req.user.role !== 'admin' || req.user.department !== 'management') {
      return res.status(403).json({
        success: false,
        message: 'Only management department admins can delete form templates'
      });
    }

    const template = await FormTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    await template.deleteOne();

    res.json({
      success: true,
      message: 'Form template deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Duplicate form template
// @route   POST /api/form-templates/:id/duplicate
// @access  Private (Admin only)
exports.duplicateFormTemplate = async (req, res) => {
  try {
    const originalTemplate = await FormTemplate.findById(req.params.id);

    if (!originalTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Form template not found'
      });
    }

    // Create duplicate
    const duplicate = await FormTemplate.create({
      title: {
        en: `${originalTemplate.title.en} (Copy)`,
        ar: `${originalTemplate.title.ar} (نسخة)`
      },
      description: originalTemplate.description,
      sections: originalTemplate.sections,
      visibleToRoles: originalTemplate.visibleToRoles,
      editableByRoles: originalTemplate.editableByRoles,
      departments: originalTemplate.departments,
      requiresApproval: originalTemplate.requiresApproval,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      data: duplicate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


