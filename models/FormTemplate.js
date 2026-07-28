const mongoose = require('mongoose');
const {
  FORM_VISIBILITY_ROLE_VALUES,
  isValidDepartmentCode,
  normalizeDepartmentCode
} = require('../utils/tenantConstants');
const {
  DOCUMENT_VERSION,
  SUPPORTED_DOCUMENT_VERSIONS,
  BLOCK_TYPES,
  PLACEMENTS,
  REPEAT_MODES,
  GRID_COLUMNS
} = require('../utils/document/documentModel');
const { PAGE_SIZE_VALUES, ORIENTATION_VALUES } = require('../utils/document/units');

/**
 * Mongoose runs in strict mode, so any property that is not declared here is
 * silently discarded on save. Every property the Template Builder produces is
 * therefore declared explicitly — the round-trip test in
 * `__tests__/formTemplateSchema.test.js` fails if the two ever drift again.
 */

const localizedString = () => ({ en: String, ar: String });

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
    enum: ['text', 'textarea', 'static_text', 'number', 'boolean', 'select', 'date', 'time', 'datetime', 'image', 'file'],
    required: true
  },
  defaultValue: localizedString(),
  options: [localizedString()],
  required: {
    type: Boolean,
    default: false
  },
  placeholder: localizedString(),
  // Layout and positioning
  order: {
    type: Number,
    default: 0
  },
  // Legacy semantic width token. Kept in sync with `grid.w` so older clients and
  // any external consumer keep working after a save from the new builder.
  width: {
    type: String,
    enum: ['full', 'half', 'third', 'two-thirds', 'quarter', 'three-quarters'],
    default: 'full'
  },
  // Layout-v2 placement inside the section's 24-column grid.
  grid: {
    x: { type: Number, default: 0, min: 0, max: GRID_COLUMNS - 1 },
    w: { type: Number, default: GRID_COLUMNS, min: 1, max: GRID_COLUMNS },
    row: { type: Number, default: 0, min: 0 }
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
    fontSize: { type: Number, default: 10 },
    imageWidth: { type: Number, default: 220 },
    imageHeight: { type: Number, default: 160 },
    objectFit: {
      type: String,
      enum: ['cover', 'contain', 'fill'],
      default: 'cover'
    },
    borderRadius: { type: Number, default: 16 },
    borderWidth: { type: Number, default: 0 },
    borderColor: { type: String, default: '#d1d5db' },
    backgroundColor: { type: String, default: '#f8fafc' },
    shadow: { type: Boolean, default: false }
  }
});

const tableColumnBaseDefinition = {
  id: String,
  label: localizedString(),
  fieldKey: String,
  fieldType: {
    type: String,
    // `image` and `static_text` were selectable in the builder but rejected here,
    // which failed the whole save with a validation error.
    enum: ['text', 'textarea', 'static_text', 'number', 'boolean', 'select', 'date', 'time', 'datetime', 'image', 'file'],
    default: 'text'
  },
  width: { type: String, default: 'auto' },
  alignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
  headerStyle: {
    backgroundColor: String,
    textColor: String,
    fontSize: Number,
    bold: Boolean
  }
};

const subSchemaOptions = { _id: false, id: false };

// Three levels of grouping. The previous two-level cap silently deleted any
// deeper grouping the builder allowed the author to create.
const tableGrandChildColumnSchema = new mongoose.Schema(tableColumnBaseDefinition, subSchemaOptions);
const tableChildColumnSchema = new mongoose.Schema({
  ...tableColumnBaseDefinition,
  children: [tableGrandChildColumnSchema]
}, subSchemaOptions);
const tableColumnSchema = new mongoose.Schema({
  ...tableColumnBaseDefinition,
  children: [tableChildColumnSchema]
}, subSchemaOptions);

const footerSocialLinkSchema = new mongoose.Schema({
  id: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['website', 'email', 'facebook', 'instagram', 'linkedin', 'youtube', 'whatsapp', 'telegram', 'x', 'tiktok', 'snapchat', 'discord', 'pinterest', 'github'],
    default: 'website'
  },
  url: {
    type: String,
    trim: true
  }
}, subSchemaOptions);

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
    // `approval` is offered by the builder; rejecting it here failed the save.
    enum: ['normal', 'header', 'footer', 'signature', 'approval', 'stamp', 'totals', 'notes'],
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
      columns: [tableColumnSchema],
      dynamicRows: { type: Boolean, default: false }, // For repeating items
      rowSource: String, // Field key that contains array of items
      showHeader: { type: Boolean, default: true },
      showBorders: { type: Boolean, default: true },
      stripedRows: { type: Boolean, default: false },
      // Previously dropped on save: the builder let authors set these and the
      // value never survived a reload.
      numberOfRows: { type: Number, default: 6, min: 0, max: 500 },
      borderStyle: { type: String, enum: ['solid', 'dashed', 'dotted', 'double', 'none'], default: 'solid' },
      borderColor: { type: String, default: '#d1d5db' },
      borderWidth: { type: Number, default: 1 },
      headerStyle: {
        backgroundColor: { type: String, default: '#f3f4f6' },
        textColor: { type: String, default: '#111827' },
        fontSize: { type: Number, default: 12 },
        bold: { type: Boolean, default: true }
      },
      cellStyle: {
        backgroundColor: { type: String, default: '#ffffff' },
        textColor: { type: String, default: '#111827' },
        fontSize: { type: Number, default: 11 }
      }
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

/* ------------------------------------------------------------------------- */
/* Layout v2 document                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Union of every block type's props. Declaring them explicitly (rather than
 * using `Mixed`) keeps validation, defaults and change tracking working, which
 * is exactly what the old `Mixed`-free schema got right and the drifting
 * sub-objects got wrong.
 */
const blockPropsSchema = new mongoose.Schema({
  // text
  content: localizedString(),
  fontSize: Number,
  bold: Boolean,
  italic: Boolean,
  align: { type: String, enum: ['start', 'end', 'left', 'center', 'right', 'justify'] },
  color: String,
  backgroundColor: String,
  lineSpacing: Number,
  // divider
  thickness: Number,
  style: { type: String, enum: ['solid', 'dashed', 'dotted'] },
  insetMm: Number,
  // image / stamp / watermark
  url: String,
  fit: { type: String, enum: ['cover', 'contain', 'fill'] },
  borderRadius: Number,
  borderWidth: Number,
  borderColor: String,
  opacity: Number,
  rotation: Number,
  sizePercent: Number,
  label: localizedString(),
  // qr
  value: String,
  foreground: String,
  background: String,
  caption: localizedString()
}, subSchemaOptions);

const blockOverlaySchema = new mongoose.Schema({
  pageScope: { type: String, enum: ['all', 'first'], default: 'all' },
  xMm: { type: Number, default: 20 },
  yMm: { type: Number, default: 20 },
  wMm: { type: Number, default: 40 },
  hMm: { type: Number, default: 40 },
  rotation: { type: Number, default: 0 },
  opacity: { type: Number, default: 100, min: 0, max: 100 }
}, subSchemaOptions);

const documentBlockSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, enum: BLOCK_TYPES, required: true },
  placement: { type: String, enum: PLACEMENTS, default: 'flow' },
  x: { type: Number, default: 0, min: 0, max: GRID_COLUMNS - 1 },
  w: { type: Number, default: GRID_COLUMNS, min: 1, max: GRID_COLUMNS },
  row: { type: Number, default: 0, min: 0 },
  heightMm: { type: Number, default: null },
  minHeightMm: { type: Number, default: 0 },
  hidden: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  keepTogether: { type: Boolean, default: false },
  breakBefore: { type: Boolean, default: false },
  repeat: { type: String, enum: REPEAT_MODES, default: 'all' },
  refId: { type: String, default: null },
  overlay: { type: blockOverlaySchema, default: null },
  props: { type: blockPropsSchema, default: () => ({}) }
}, subSchemaOptions);

const documentSchema = new mongoose.Schema({
  /**
   * Refuse to persist a document this build cannot render. A field validator
   * (rather than a `pre('validate')` hook) is used deliberately so the rejection
   * also fires for `validateSync()`, which skips middleware.
   */
  version: {
    type: Number,
    default: DOCUMENT_VERSION,
    validate: {
      validator: (value) => value === undefined
        || value === null
        || SUPPORTED_DOCUMENT_VERSIONS.includes(Number(value)),
      message: (props) => `Unsupported document layout version ${props.value}. Supported versions: ${SUPPORTED_DOCUMENT_VERSIONS.join(', ')}.`
    }
  },
  page: {
    size: { type: String, enum: PAGE_SIZE_VALUES, default: 'A4' },
    orientation: { type: String, enum: ORIENTATION_VALUES, default: 'portrait' },
    // Millimetres — the unit template authors work in and the unit the canvas,
    // preview and PDF all consume. (Legacy `layout.margins` are PDF points.)
    margins: {
      top: { type: Number, default: 14, min: 0, max: 100 },
      right: { type: Number, default: 12, min: 0, max: 100 },
      bottom: { type: Number, default: 14, min: 0, max: 100 },
      left: { type: Number, default: 12, min: 0, max: 100 }
    }
  },
  grid: {
    columns: { type: Number, default: GRID_COLUMNS },
    gutterMm: { type: Number, default: 3, min: 0, max: 20 },
    rowGapMm: { type: Number, default: 3, min: 0, max: 40 },
    snap: { type: Boolean, default: true },
    showGrid: { type: Boolean, default: true }
  },
  blocks: [documentBlockSchema]
}, subSchemaOptions);

const formTemplateSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  title: {
    en: { type: String, required: true },
    ar: { type: String, required: true }
  },
  description: localizedString(),
  sections: [sectionSchema],
  visibleToRoles: [{
    type: String,
    enum: FORM_VISIBILITY_ROLE_VALUES
  }],
  editableByRoles: [{
    type: String,
    enum: FORM_VISIBILITY_ROLE_VALUES
  }],
  departments: [{
    type: String,
    trim: true,
    lowercase: true,
    set: normalizeDepartmentCode,
    validate: {
      validator: (value) => !value || isValidDepartmentCode(value, { allowAll: true }),
      message: 'Department code must use lowercase letters, numbers, hyphens, or underscores'
    }
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
  /**
   * 1 = legacy flow-only template (adapted at read time, never rewritten until
   * the author saves). 2 = designed in the visual builder.
   */
  layoutVersion: {
    type: Number,
    default: 1,
    min: 1
  },
  // Visual document definition (layout v2).
  document: {
    type: documentSchema,
    default: undefined
  },
  // Legacy layout configuration. Retained so templates saved by the new builder
  // stay readable by any consumer that has not been updated yet.
  layout: {
    // Section ordering and visibility
    sectionOrder: [String], // Array of section IDs in display order
    // PDF page settings
    pageSize: {
      type: String,
      enum: PAGE_SIZE_VALUES,
      default: 'A4'
    },
    orientation: {
      type: String,
      enum: ORIENTATION_VALUES,
      default: 'portrait'
    },
    // PDF points (kept for backward compatibility; `document.page.margins` is mm)
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
      // Previously dropped on save.
      showSubtitle: { type: Boolean, default: false },
      subtitle: localizedString(),
      titleStyle: { type: String, default: 'normal' },
      titleColor: { type: String, default: '' },
      decorativeLineColor: { type: String, default: '' },
      dashedBorder: { type: Boolean, default: false },
      layout: {
        type: String,
        enum: ['default', 'split'],
        default: 'default'
      },
      height: { type: Number, default: 80 },
      logoSize: { type: Number, default: 64 },
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
      showQRCode: { type: Boolean, default: false },
      showPhoneNumber: { type: Boolean, default: false },
      showSocialIcons: { type: Boolean, default: false },
      qrCodePosition: {
        type: String,
        enum: ['left', 'center', 'right'],
        default: 'center'
      },
      qrCodeSize: { type: Number, default: 84 },
      template: {
        type: String,
        enum: ['classic', 'centered', 'contact', 'minimal'],
        default: 'classic'
      },
      height: { type: Number, default: 50 },
      backgroundColor: { type: String, default: '#f9fafb' },
      textColor: { type: String, default: '#6b7280' },
      fontSize: { type: Number, default: 8 },
      phoneNumber: String,
      qrCodeValue: String,
      // Previously dropped on save.
      companyName: String,
      socialLinks: [footerSocialLinkSchema],
      content: localizedString()
    },
    // Branding
    branding: {
      primaryColor: { type: String, default: '#d4b900' },
      secondaryColor: { type: String, default: '#b51c20' },
      logoUrl: String,
      watermarkUrl: String,
      watermarkSize: { type: Number, default: 55 },
      watermarkOpacity: { type: Number, default: 5 },
      companyName: localizedString(),
      companyAddress: localizedString(),
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
      // Previously dropped on save.
      secondary: { type: String, default: '' },
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
    },
    signature: {
      enabled: { type: Boolean, default: true },
      showPreparedBy: { type: Boolean, default: true },
      showApprovedBy: { type: Boolean, default: true }
    }
  }
}, {
  timestamps: true
});

/** A template carrying a visual document is by definition layout v2. */
formTemplateSchema.pre('validate', function syncLayoutVersion(next) {
  if (this.document && Number(this.layoutVersion) !== DOCUMENT_VERSION) {
    this.layoutVersion = DOCUMENT_VERSION;
  }
  return next();
});

// Index for faster queries
formTemplateSchema.index({ organizationId: 1, createdBy: 1, createdAt: -1 });
formTemplateSchema.index({ organizationId: 1, departments: 1, isActive: 1 });
formTemplateSchema.index({ organizationId: 1, isActive: 1, createdAt: -1 });
formTemplateSchema.index({ 'title.en': 'text', 'title.ar': 'text' });

module.exports = mongoose.model('FormTemplate', formTemplateSchema);
