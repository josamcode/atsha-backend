/**
 * Shared document contract — deterministic layout v1 → v2 migration.
 *
 * SHARED MODULE (see units.js for the mirroring rules).
 *
 * Every legacy template is adapted at READ time. Nothing is written back to the
 * database until the author saves in the new builder, so opening an old template
 * can never damage it. The transform is pure and deterministic: the same input
 * always produces the same block ids, ordering and geometry, which is what makes
 * the migration testable and lets an unchanged template round-trip byte-stable.
 */

const { ptToMm, clampNumber } = require('./units');
const {
  DOCUMENT_VERSION,
  GRID_COLUMNS,
  createBlock,
  getDefaultDocument
} = require('./documentModel');

/** Legacy semantic width tokens expressed in 24-column grid units. */
const WIDTH_TOKEN_COLUMNS = {
  full: 24,
  half: 12,
  third: 8,
  'two-thirds': 16,
  quarter: 6,
  'three-quarters': 18
};

const COLUMNS_TO_WIDTH_TOKEN = [
  { columns: 24, token: 'full' },
  { columns: 18, token: 'three-quarters' },
  { columns: 16, token: 'two-thirds' },
  { columns: 12, token: 'half' },
  { columns: 8, token: 'third' },
  { columns: 6, token: 'quarter' }
];

const columnsForWidthToken = (token) => WIDTH_TOKEN_COLUMNS[token] || WIDTH_TOKEN_COLUMNS.full;

/** Nearest legacy token for a grid span, so old consumers keep working. */
const widthTokenForColumns = (columns) => {
  const span = clampNumber(columns, 24, 1, GRID_COLUMNS);
  let best = COLUMNS_TO_WIDTH_TOKEN[0];
  let bestDistance = Infinity;
  COLUMNS_TO_WIDTH_TOKEN.forEach((entry) => {
    const distance = Math.abs(entry.columns - span);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  });
  return best.token;
};

/**
 * Split 24 grid columns across `count` legacy CSS column widths
 * (`1fr`, `2fr`, `50%`, `160px`, `auto`…). Always sums to exactly 24.
 */
const splitGridColumns = (count, columnWidths) => {
  const columns = Math.max(1, Math.min(GRID_COLUMNS, Math.round(count) || 1));
  const weights = [];

  for (let i = 0; i < columns; i += 1) {
    const raw = Array.isArray(columnWidths) ? columnWidths[i] : undefined;
    let weight = 1;
    if (typeof raw === 'string' && raw.trim()) {
      const value = raw.trim();
      const frMatch = /^([\d.]+)fr$/i.exec(value);
      const percentMatch = /^([\d.]+)%$/.exec(value);
      const pxMatch = /^([\d.]+)px$/i.exec(value);
      if (frMatch) {
        weight = Number(frMatch[1]) || 1;
      } else if (percentMatch) {
        weight = (Number(percentMatch[1]) || 0) / 100 * columns;
      } else if (pxMatch) {
        // Treat pixels as a share of a nominal 720px content width.
        weight = ((Number(pxMatch[1]) || 0) / 720) * columns;
      }
    }
    weights.push(weight > 0 ? weight : 1);
  }

  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || columns;
  const spans = weights.map((weight) => Math.max(1, Math.round((weight / totalWeight) * GRID_COLUMNS)));

  // Fix rounding drift so the row always fills exactly 24 columns.
  let drift = GRID_COLUMNS - spans.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  while (drift !== 0 && spans.length > 0) {
    const index = cursor % spans.length;
    if (drift > 0) {
      spans[index] += 1;
      drift -= 1;
    } else if (spans[index] > 1) {
      spans[index] -= 1;
      drift += 1;
    }
    cursor += 1;
    if (cursor > spans.length * (GRID_COLUMNS + 2)) {
      break;
    }
  }

  return spans;
};

/**
 * Derive `{x, w}` grid placement for a section's fields from its legacy layout
 * configuration. Fields that already carry a grid keep it untouched.
 */
const deriveFieldGrids = (section) => {
  const fields = Array.isArray(section?.fields) ? section.fields : [];
  if (fields.length === 0) {
    return [];
  }

  const advanced = section?.advancedLayout || {};
  const layoutType = advanced.layoutType || 'simple';

  if (layoutType === 'columns' || layoutType === 'grid') {
    const config = layoutType === 'columns' ? (advanced.columns || {}) : (advanced.grid || {});
    const count = layoutType === 'columns'
      ? (config.columnCount || 2)
      : (config.columns || 2);
    const widths = layoutType === 'columns'
      ? config.columnWidths
      : (typeof config.template === 'string' ? config.template.trim().split(/\s+/) : undefined);
    const spans = splitGridColumns(count, widths);

    const offsets = [];
    let offset = 0;
    spans.forEach((span) => {
      offsets.push(offset);
      offset += span;
    });

    return fields.map((field, index) => {
      if (field?.grid && Number.isFinite(Number(field.grid.w))) {
        return field.grid;
      }
      const columnIndex = index % spans.length;
      return {
        x: offsets[columnIndex],
        w: spans[columnIndex],
        row: Math.floor(index / spans.length)
      };
    });
  }

  // simple (and table sections, whose fields are not laid out but still need a
  // stable placement in case the author switches the layout later).
  let cursor = 0;
  let row = 0;
  return fields.map((field) => {
    if (field?.grid && Number.isFinite(Number(field.grid.w))) {
      return field.grid;
    }
    const span = Math.min(GRID_COLUMNS, columnsForWidthToken(field?.width));
    if (cursor + span > GRID_COLUMNS) {
      cursor = 0;
      row += 1;
    }
    const placement = { x: cursor, w: span, row };
    cursor += span;
    if (cursor >= GRID_COLUMNS) {
      cursor = 0;
      row += 1;
    }
    return placement;
  });
};

/** Attach derived grids to a section's fields, keeping `width` in sync. */
const withFieldGrids = (section) => {
  const grids = deriveFieldGrids(section);
  const fields = (Array.isArray(section?.fields) ? section.fields : []).map((field, index) => {
    const grid = grids[index] || { x: 0, w: GRID_COLUMNS, row: index };
    const x = Math.round(clampNumber(grid.x, 0, 0, GRID_COLUMNS - 1));
    const w = Math.round(clampNumber(grid.w, GRID_COLUMNS, 1, GRID_COLUMNS - x));
    const row = Math.round(clampNumber(grid.row, index, 0, 100000));
    return Object.assign({}, field, {
      grid: { x, w, row },
      width: field?.grid ? widthTokenForColumns(w) : (field?.width || widthTokenForColumns(w))
    });
  });

  return Object.assign({}, section, { fields });
};

/**
 * Repair sections that a hand-edit or an old client could have left malformed.
 *
 * Nothing is dropped and no existing id is renamed — a section id is the prefix
 * of every stored value key, so renaming one would orphan real submission data.
 * A section with NO id never had valid value keys, so giving it a deterministic
 * one is safe and is what makes it visible (and therefore fixable) in the
 * builder instead of failing the next save with a server-side error.
 */
const repairSections = (sections) => {
  const list = Array.isArray(sections) ? sections : [];
  return list
    .filter((section) => section && typeof section === 'object')
    .map((section, index) => (section.id
      ? section
      : Object.assign({}, section, { id: `section_recovered_${index}` })));
};

/**
 * Blocks are keyed by section id, so duplicate section ids would produce
 * duplicate block ids and every `find`/`map` in the editor would collapse onto
 * one of them. Suffix later occurrences so each section keeps its own block.
 */
const blockIdForSection = (sectionId, occurrence) => (
  occurrence === 0 ? `blk_section_${sectionId}` : `blk_section_${sectionId}__${occurrence}`
);

const orderSections = (template) => {
  const sections = repairSections(template?.sections);
  const order = Array.isArray(template?.layout?.sectionOrder) ? template.layout.sectionOrder : [];

  if (order.length === 0) {
    return [...sections].sort((a, b) => (a?.order || 0) - (b?.order || 0));
  }

  // Consume each section exactly once so duplicate ids in `sectionOrder` cannot
  // list the same section twice while silently dropping its namesake.
  const pending = new Map();
  sections.forEach((section) => {
    const queue = pending.get(section.id) || [];
    queue.push(section);
    pending.set(section.id, queue);
  });

  const ordered = [];
  order.forEach((id) => {
    const queue = pending.get(id);
    if (queue && queue.length > 0) {
      ordered.push(queue.shift());
    }
  });
  sections.forEach((section) => {
    const queue = pending.get(section.id);
    if (queue && queue.includes(section)) {
      queue.splice(queue.indexOf(section), 1);
      ordered.push(section);
    }
  });

  return ordered;
};

/**
 * Build a layout-v2 document from a layout-v1 template.
 * Deterministic: block ids are derived from the block type and section id.
 */
const buildDocumentFromLegacy = (template) => {
  const defaults = getDefaultDocument();
  const layout = template?.layout || {};
  const pdfStyle = template?.pdfStyle || {};
  const legacyMargins = layout.margins || {};

  const page = {
    size: layout.pageSize || 'A4',
    orientation: layout.orientation || 'portrait',
    // Legacy margins were stored in PDF points (PDFKit consumed them directly).
    margins: {
      top: Number.isFinite(Number(legacyMargins.top)) ? ptToMm(legacyMargins.top) : defaults.page.margins.top,
      right: Number.isFinite(Number(legacyMargins.right)) ? ptToMm(legacyMargins.right) : defaults.page.margins.right,
      bottom: Number.isFinite(Number(legacyMargins.bottom)) ? ptToMm(legacyMargins.bottom) : defaults.page.margins.bottom,
      left: Number.isFinite(Number(legacyMargins.left)) ? ptToMm(legacyMargins.left) : defaults.page.margins.left
    }
  };

  const blocks = [];
  let row = 0;

  if (pdfStyle.header?.enabled !== false) {
    blocks.push(createBlock('header', {
      id: 'blk_header',
      placement: 'pageHeader',
      repeat: 'all',
      row: 0,
      x: 0,
      w: GRID_COLUMNS
    }));
  }

  if (pdfStyle.metadata?.enabled !== false) {
    blocks.push(createBlock('metadata', {
      id: 'blk_metadata',
      placement: 'flow',
      row,
      x: 0,
      w: GRID_COLUMNS
    }));
    row += 1;
  }

  const seenSectionIds = new Map();
  orderSections(template).forEach((section) => {
    const occurrence = seenSectionIds.get(section.id) || 0;
    seenSectionIds.set(section.id, occurrence + 1);

    blocks.push(createBlock('section', {
      id: blockIdForSection(section.id, occurrence),
      placement: 'flow',
      refId: section.id,
      hidden: section.visible === false,
      row,
      x: 0,
      w: GRID_COLUMNS
    }));
    row += 1;
  });

  if (pdfStyle.signature?.enabled !== false) {
    blocks.push(createBlock('signature', {
      id: 'blk_signature',
      placement: 'flow',
      keepTogether: true,
      row,
      x: 0,
      w: GRID_COLUMNS
    }));
    row += 1;
  }

  if (pdfStyle.footer?.enabled !== false) {
    blocks.push(createBlock('footer', {
      id: 'blk_footer',
      placement: 'pageFooter',
      repeat: 'all',
      row: 0,
      x: 0,
      w: GRID_COLUMNS
    }));
  }

  // The legacy browser renderer always painted a watermark, falling back through
  // watermarkUrl → logoUrl → /logo.png. Recreating it as an overlay block keeps
  // migrated documents looking identical while making it editable and removable.
  blocks.push(createBlock('watermark', {
    id: 'blk_watermark',
    placement: 'overlay',
    overlay: {
      pageScope: 'all',
      xMm: 0,
      yMm: 0,
      wMm: 0,
      hMm: 0,
      rotation: 10,
      opacity: clampNumber(pdfStyle.branding?.watermarkOpacity, 5, 0, 100)
    },
    props: {
      url: pdfStyle.branding?.watermarkUrl || '',
      opacity: clampNumber(pdfStyle.branding?.watermarkOpacity, 5, 0, 100),
      sizePercent: clampNumber(pdfStyle.branding?.watermarkSize, 55, 0, 100),
      rotation: 10
    }
  }));

  return {
    version: DOCUMENT_VERSION,
    page,
    grid: Object.assign({}, defaults.grid),
    blocks
  };
};

/** True when the template still needs the v1 → v2 adapter. */
const needsMigration = (template) => {
  const documentValue = template?.document;
  if (!documentValue || typeof documentValue !== 'object') {
    return true;
  }
  if (!Array.isArray(documentValue.blocks) || documentValue.blocks.length === 0) {
    return true;
  }
  return Number(documentValue.version) !== DOCUMENT_VERSION;
};

module.exports = {
  WIDTH_TOKEN_COLUMNS,
  columnsForWidthToken,
  widthTokenForColumns,
  splitGridColumns,
  deriveFieldGrids,
  withFieldGrids,
  orderSections,
  repairSections,
  blockIdForSection,
  buildDocumentFromLegacy,
  needsMigration
};
