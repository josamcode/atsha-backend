const mongoose = require('mongoose');

const fieldSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true
  },
  label: {
    en: { type: String, required: true },
    ar: { type: String, required: true }
  },
  type: {
    type: String,
    enum: ['text', 'textarea', 'number', 'boolean', 'select', 'date', 'time', 'datetime', 'file'],
    required: true
  },
  options: [{
    en: String,
    ar: String
  }],
  required: {
    type: Boolean,
    default: false
  },
  placeholder: {
    en: String,
    ar: String
  },
  // Layout and positioning
  order: {
    type: Number,
    default: 0
  },
  width: {
    type: String,
    enum: ['full', 'half', 'third', 'two-thirds', 'quarter', 'three-quarters'],
    default: 'full'
  },
  visible: {
    type: Boolean,
    default: true
  },
  // PDF-specific display options
  pdfDisplay: {
    showLabel: { type: Boolean, default: true },
    showValue: { type: Boolean, default: true },
    fontSize: { type: Number, default: 10 },
    bold: { type: Boolean, default: false },
    alignment: { type: String, enum: ['left', 'center', 'right', 'justify'], default: 'left' }
  },
  // Advanced layout properties
  layout: {
    width: { type: String, default: 'auto' }, // auto, px, %, etc.
    height: { type: String, default: 'auto' },
    padding: {
      top: { type: Number, default: 0 },
      right: { type: Number, default: 0 },
      bottom: { type: Number, default: 0 },
      left: { type: Number, default: 0 }
    },
    margin: {
      top: { type: Number, default: 0 },
      right: { type: Number, default: 0 },
      bottom: { type: Number, default: 0 },
      left: { type: Number, default: 0 }
    },
    alignment: { type: String, enum: ['left', 'center', 'right', 'justify'], default: 'left' },
    lineSpacing: { type: Number, default: 1.2 },
    fontSize: { type: Number, default: 10 }
  }
});

const sectionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  label: {
    en: { type: String, required: true },
    ar: { type: String, required: true }
  },
  fields: [fieldSchema],
  // Layout configuration
  order: {
    type: Number,
    default: 0
  },
  visible: {
    type: Boolean,
    default: true
  },
  // Section type for special handling (header, footer, signature, etc.)
  sectionType: {
    type: String,
    enum: ['normal', 'header', 'footer', 'signature', 'stamp', 'totals', 'notes'],
    default: 'normal'
  },
  // PDF-specific styling
  pdfStyle: {
    backgroundColor: { type: String, default: '#ffffff' },
    borderColor: { type: String, default: '#e5e7eb' },
    borderWidth: { type: Number, default: 1 },
    padding: { type: Number, default: 10 },
    marginTop: { type: Number, default: 10 },
    marginBottom: { type: Number, default: 10 },
    showBorder: { type: Boolean, default: true },
    showBackground: { type: Boolean, default: false }
  },
  // Advanced layout configuration
  advancedLayout: {
    layoutType: {
      type: String,
      enum: ['simple', 'table', 'columns', 'grid'],
      default: 'simple'
    },
    // Table layout configuration
    table: {
      enabled: { type: Boolean, default: false },
      columns: [{
        id: String,
        label: { en: String, ar: String },
        fieldKey: String, // Which field goes in this column
        fieldType: {
          type: String,
          enum: ['text', 'textarea', 'number', 'boolean', 'select', 'date', 'time', 'datetime', 'file'],
          default: 'text'
        }, // Field input type for this column
        width: { type: String, default: 'auto' }, // auto, px, %
        alignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
        headerStyle: {
          backgroundColor: String,
          textColor: String,
          fontSize: Number,
          bold: Boolean
        }
      }],
      dynamicRows: { type: Boolean, default: false }, // For repeating items
      rowSource: String, // Field key that contains array of items
      showHeader: { type: Boolean, default: true },
      showBorders: { type: Boolean, default: true },
      stripedRows: { type: Boolean, default: false }
    },
    // Column layout configuration
    columns: {
      enabled: { type: Boolean, default: false },
      columnCount: { type: Number, default: 2, min: 1, max: 12 },
      columnGap: { type: Number, default: 20 },
      columnWidths: [String], // Array of widths (e.g., ['50%', '50%'])
      equalWidths: { type: Boolean, default: true }
    },
    // Grid layout configuration
    grid: {
      enabled: { type: Boolean, default: false },
      rows: { type: Number, default: 1 },
      columns: { type: Number, default: 1 },
      gap: { type: Number, default: 10 },
      template: String // CSS grid template (e.g., '1fr 1fr 1fr')
    },
    // Spacing and sizing
    spacing: {
      sectionSpacing: { type: Number, default: 20 },
      fieldSpacing: { type: Number, default: 10 },
      lineSpacing: { type: Number, default: 1.2 }
    },
    // Sizing
    sizing: {
      width: { type: String, default: '100%' },
      maxWidth: { type: String, default: '100%' },
      minWidth: { type: String, default: 'auto' },
      height: { type: String, default: 'auto' },
      maxHeight: { type: String, default: 'auto' },
      minHeight: { type: String, default: 'auto' }
    },
    // Padding and margins
    padding: {
      top: { type: Number, default: 10 },
      right: { type: Number, default: 10 },
      bottom: { type: Number, default: 10 },
      left: { type: Number, default: 10 }
    },
    margins: {
      top: { type: Number, default: 10 },
      right: { type: Number, default: 10 },
      bottom: { type: Number, default: 10 },
      left: { type: Number, default: 10 }
    },
    // Section styling options
    styling: {
      titleColor: { type: String, default: '#000000' },
      titleFontSize: { type: Number, default: 20 },
      showTitle: { type: Boolean, default: true },
      backgroundColor: { type: String, default: '#ffffff' },
      textColor: { type: String, default: '#000000' },
      borderColor: { type: String, default: '#e5e7eb' }
    }
  }
});

const formTemplateSchema = new mongoose.Schema({
  title: {
    en: { type: String, required: true },
    ar: { type: String, required: true }
  },
  description: {
    en: String,
    ar: String
  },
  sections: [sectionSchema],
  visibleToRoles: [{
    type: String,
    enum: ['admin', 'supervisor', 'employee']
  }],
  editableByRoles: [{
    type: String,
    enum: ['admin', 'supervisor', 'employee']
  }],
  departments: [{
    type: String,
    enum: ['kitchen', 'counter', 'cleaning', 'management', 'delivery', 'other', 'all']
  }],
  requiresApproval: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Layout configuration
  layout: {
    // Section ordering and visibility
    sectionOrder: [String], // Array of section IDs in display order
    // PDF page settings
    pageSize: {
      type: String,
      enum: ['A4', 'Letter', 'Legal'],
      default: 'A4'
    },
    orientation: {
      type: String,
      enum: ['portrait', 'landscape'],
      default: 'portrait'
    },
    margins: {
      top: { type: Number, default: 50 },
      right: { type: Number, default: 50 },
      bottom: { type: Number, default: 50 },
      left: { type: Number, default: 50 }
    }
  },
  // PDF styling and branding
  pdfStyle: {
    // Header configuration
    header: {
      enabled: { type: Boolean, default: true },
      showLogo: { type: Boolean, default: true },
      showTitle: { type: Boolean, default: true },
      showDate: { type: Boolean, default: true },
      showCompanyName: { type: Boolean, default: true },
      showCompanyAddress: { type: Boolean, default: true },
      layout: {
        type: String,
        enum: ['default', 'split'], // default: logo+company left, form title right | split: logo+company left, form title right
        default: 'default'
      },
      height: { type: Number, default: 80 },
      backgroundColor: { type: String, default: '#ffffff' },
      textColor: { type: String, default: '#000000' },
      fontSize: { type: Number, default: 16 },
      logoPosition: {
        type: String,
        enum: ['left', 'center', 'right'],
        default: 'left'
      },
      border: {
        show: { type: Boolean, default: true },
        width: { type: Number, default: 4 },
        style: {
          type: String,
          enum: ['solid', 'dashed', 'dotted', 'double', 'none'],
          default: 'solid'
        },
        color: { type: String, default: '#d4b900' },
        position: {
          type: String,
          enum: ['top', 'bottom', 'left', 'right', 'all', 'none'],
          default: 'bottom'
        }
      }
    },
    // Footer configuration
    footer: {
      enabled: { type: Boolean, default: true },
      showPageNumbers: { type: Boolean, default: true },
      showCompanyInfo: { type: Boolean, default: true },
      height: { type: Number, default: 50 },
      backgroundColor: { type: String, default: '#f9fafb' },
      textColor: { type: String, default: '#6b7280' },
      fontSize: { type: Number, default: 8 },
      content: {
        en: String,
        ar: String
      }
    },
    // Branding
    branding: {
      primaryColor: { type: String, default: '#d4b900' },
      secondaryColor: { type: String, default: '#b51c20' },
      logoUrl: String,
      companyName: {
        en: String,
        ar: String
      },
      companyAddress: {
        en: String,
        ar: String
      },
      companyPhone: String,
      companyEmail: String
    },
    // General styling
    fontFamily: {
      type: String,
      default: 'Helvetica'
    },
    fontSize: {
      title: { type: Number, default: 18 },
      section: { type: Number, default: 14 },
      field: { type: Number, default: 10 }
    },
    colors: {
      primary: { type: String, default: '#d4b900' },
      text: { type: String, default: '#000000' },
      border: { type: String, default: '#e5e7eb' },
      background: { type: String, default: '#ffffff' }
    },
    spacing: {
      sectionSpacing: { type: Number, default: 20 },
      fieldSpacing: { type: Number, default: 10 },
      lineSpacing: { type: Number, default: 1.2 }
    },
    // Form metadata display settings
    metadata: {
      enabled: { type: Boolean, default: true },
      showFormId: { type: Boolean, default: true },
      showDate: { type: Boolean, default: true },
      showShift: { type: Boolean, default: true },
      showDepartment: { type: Boolean, default: true },
      showFilledBy: { type: Boolean, default: true },
      showSubmittedOn: { type: Boolean, default: true },
      showApprovedBy: { type: Boolean, default: true },
      showApprovalDate: { type: Boolean, default: true }
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
formTemplateSchema.index({ 'title.en': 'text', 'title.ar': 'text' });

module.exports = mongoose.model('FormTemplate', formTemplateSchema);

