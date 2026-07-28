/**
 * Shared document contract — the single entry point every consumer uses.
 *
 * SHARED MODULE (see units.js for the mirroring rules).
 *
 * `resolveTemplateContract()` turns any template — legacy v1, freshly migrated,
 * or authored in the new builder — into the exact shape the layout engine, the
 * React renderer, the PDF generator and the fill screen all agree on.
 */

const { clampNumber } = require('./units');
const {
  DOCUMENT_VERSION,
  GRID_COLUMNS,
  createBlock,
  normalizeDocument,
  assertSupportedDocumentVersion
} = require('./documentModel');
const {
  buildDocumentFromLegacy,
  needsMigration,
  withFieldGrids,
  repairSections,
  blockIdForSection
} = require('./migrate');

const FIELD_TYPES = [
  'text', 'textarea', 'static_text', 'number', 'boolean',
  'select', 'date', 'time', 'datetime', 'image', 'file'
];

const TABLE_COLUMN_FIELD_TYPES = [
  'text', 'textarea', 'number', 'boolean', 'select', 'date', 'time', 'datetime', 'image', 'file'
];

const SECTION_TYPES = ['normal', 'header', 'footer', 'signature', 'approval', 'stamp', 'totals', 'notes'];

const localizedText = (value, language, fallback = '') => {
  if (typeof value === 'string') {
    return value || fallback;
  }
  const isArabic = language === 'ar';
  const primary = isArabic ? value?.ar : value?.en;
  const secondary = isArabic ? value?.en : value?.ar;
  return primary || secondary || fallback;
};

/** Leaf columns of a (possibly grouped) table header, in visual order. */
const getLeafColumns = (columns) => {
  const list = Array.isArray(columns) ? columns : [];
  return list.reduce((accumulator, column) => {
    const children = Array.isArray(column?.children) ? column.children : [];
    if (children.length > 0) {
      return accumulator.concat(getLeafColumns(children));
    }
    accumulator.push(column);
    return accumulator;
  }, []);
};

/** Depth of a grouped header (1 = flat). */
const getColumnDepth = (columns) => {
  const list = Array.isArray(columns) ? columns : [];
  if (list.length === 0) {
    return 0;
  }
  return list.reduce((depth, column) => {
    const children = Array.isArray(column?.children) ? column.children : [];
    const childDepth = children.length > 0 ? getColumnDepth(children) : 0;
    return Math.max(depth, 1 + childDepth);
  }, 1);
};

/** Storage key for a table cell — must match FillForm and every historical submission. */
const getTableCellKey = (sectionId, rowIndex, column, columnIndex) => (
  `${sectionId}.row_${rowIndex}.col_${column?.id || `col${columnIndex + 1}`}`
);

/** Storage key for a regular field value. */
const getFieldValueKey = (sectionId, fieldKey) => `${sectionId}.${fieldKey}`;

/** Storage key for a dynamic table's row array. */
const getDynamicRowsKey = (sectionId, rowSource) => `${sectionId}.${rowSource}`;

const readValue = (values, key) => {
  if (!values) {
    return undefined;
  }
  if (typeof values.get === 'function') {
    const fromMap = values.get(key);
    if (fromMap !== undefined) {
      return fromMap;
    }
  }
  return values[key];
};

/**
 * Effective colour/typography theme. Organization branding fills the gaps so a
 * template that never customised its palette still matches the tenant.
 */
const resolveTheme = (template, organization) => {
  const pdfStyle = template?.pdfStyle || {};
  const branding = pdfStyle.branding || {};
  const orgBranding = organization?.branding || {};

  const primary = pdfStyle.colors?.primary || branding.primaryColor || orgBranding.primaryColor || '#01c853';
  const secondary = pdfStyle.colors?.secondary || branding.secondaryColor || orgBranding.secondaryColor || '#059669';

  return {
    primary,
    secondary,
    text: pdfStyle.colors?.text || '#111827',
    border: pdfStyle.colors?.border || '#d1d5db',
    background: pdfStyle.colors?.background || '#ffffff',
    muted: '#6b7280',
    fontFamily: pdfStyle.fontFamily || 'Helvetica',
    fontSize: {
      title: clampNumber(pdfStyle.fontSize?.title, 18, 6, 72),
      section: clampNumber(pdfStyle.fontSize?.section, 13, 6, 48),
      field: clampNumber(pdfStyle.fontSize?.field, 10, 5, 36)
    },
    spacing: {
      sectionSpacing: clampNumber(pdfStyle.spacing?.sectionSpacing, 12, 0, 96),
      fieldSpacing: clampNumber(pdfStyle.spacing?.fieldSpacing, 8, 0, 96),
      lineSpacing: clampNumber(pdfStyle.spacing?.lineSpacing, 1.3, 1, 3)
    },
    branding: {
      ...branding,
      logoUrl: branding.logoUrl || orgBranding.logoUrl || '',
      watermarkUrl: branding.watermarkUrl || orgBranding.watermarkUrl || '',
      primaryColor: primary,
      secondaryColor: secondary
    }
  };
};

/**
 * Turn any stored template into the canonical contract.
 *
 * Returns `{ ok:false, error }` for documents this build cannot render, rather
 * than silently downgrading them.
 */
const resolveTemplateContract = (template, options = {}) => {
  const source = template || {};
  const versionCheck = assertSupportedDocumentVersion(source.document);
  if (!versionCheck.ok) {
    return { ok: false, error: versionCheck, template: source };
  }

  const migrated = needsMigration(source);
  const rawDocument = migrated ? buildDocumentFromLegacy(source) : source.document;
  const documentValue = normalizeDocument(rawDocument);

  const sections = repairSections(source.sections).map(withFieldGrids);
  const sectionsById = new Map();
  sections.forEach((section) => {
    // First occurrence wins; duplicates keep their own block via a suffixed id.
    if (!sectionsById.has(section.id)) {
      sectionsById.set(section.id, section);
    }
  });

  // Drop section blocks whose section no longer exists (deleted by an old client).
  documentValue.blocks = documentValue.blocks.filter(
    (block) => block.type !== 'section' || sectionsById.has(block.refId)
  );

  // A migrated document is authoritative for ordering, but a section added by an
  // older client after the document was written would otherwise be invisible.
  // Append a block for every section the document does not already cover — count
  // per id so a duplicated id still gets one block each.
  const blockCountByRef = new Map();
  documentValue.blocks
    .filter((block) => block.type === 'section')
    .forEach((block) => {
      blockCountByRef.set(block.refId, (blockCountByRef.get(block.refId) || 0) + 1);
    });

  const covered = new Map();
  const missing = sections.filter((section) => {
    const used = covered.get(section.id) || 0;
    if (used < (blockCountByRef.get(section.id) || 0)) {
      covered.set(section.id, used + 1);
      return false;
    }
    covered.set(section.id, used + 1);
    return true;
  });

  if (missing.length > 0) {
    const maxRow = documentValue.blocks
      .filter((block) => block.placement === 'flow')
      .reduce((max, block) => Math.max(max, block.row), -1);
    const occurrences = new Map(blockCountByRef);
    missing.forEach((section, index) => {
      const occurrence = occurrences.get(section.id) || 0;
      occurrences.set(section.id, occurrence + 1);
      documentValue.blocks.push(createBlock('section', {
        id: blockIdForSection(section.id, occurrence),
        placement: 'flow',
        refId: section.id,
        hidden: section.visible === false,
        row: maxRow + 1 + index,
        x: 0,
        w: GRID_COLUMNS
      }));
    });
  }

  return {
    ok: true,
    migrated,
    version: DOCUMENT_VERSION,
    template: {
      ...source,
      sections,
      document: documentValue
    },
    document: documentValue,
    sections,
    sectionsById,
    theme: resolveTheme(source, options.organization)
  };
};

/**
 * Semantic reading order of the document: the ordering, labels, visibility and
 * field types the data-entry screen and validation must follow. Derived from the
 * document so the fill screen can never disagree with the printed page.
 */
const getSemanticSections = (contract) => {
  if (!contract?.ok) {
    return [];
  }
  const { document: documentValue, sectionsById } = contract;
  return documentValue.blocks
    .filter((block) => block.placement === 'flow' && block.type === 'section' && !block.hidden)
    .sort((a, b) => (a.row - b.row) || (a.x - b.x))
    .map((block) => sectionsById.get(block.refId))
    .filter((section) => section && section.visible !== false);
};

/**
 * Reading order of a section's fields: grid row, then logical column, falling
 * back to the legacy `order` for templates that predate grid placement. The data
 * entry screen and the printed page must agree on this, otherwise a form is
 * filled in a different order than it is read.
 */
const compareFieldsByReadingOrder = (a, b) => {
  const rowA = a?.grid?.row ?? a?.order ?? 0;
  const rowB = b?.grid?.row ?? b?.order ?? 0;
  if (rowA !== rowB) return rowA - rowB;
  const xA = a?.grid?.x ?? 0;
  const xB = b?.grid?.x ?? 0;
  if (xA !== xB) return xA - xB;
  return (a?.order || 0) - (b?.order || 0);
};

/** Visible fields of a section in document order. */
const getVisibleFields = (section) => (Array.isArray(section?.fields) ? section.fields : [])
  .filter((field) => field?.visible !== false)
  .slice()
  .sort(compareFieldsByReadingOrder);

const isTableSection = (section) => {
  const advanced = section?.advancedLayout || {};
  return advanced.layoutType === 'table'
    && Array.isArray(advanced.table?.columns)
    && advanced.table.columns.length > 0;
};

module.exports = {
  FIELD_TYPES,
  TABLE_COLUMN_FIELD_TYPES,
  SECTION_TYPES,
  localizedText,
  getLeafColumns,
  getColumnDepth,
  getTableCellKey,
  getFieldValueKey,
  getDynamicRowsKey,
  readValue,
  resolveTheme,
  resolveTemplateContract,
  getSemanticSections,
  getVisibleFields,
  compareFieldsByReadingOrder,
  isTableSection
};
