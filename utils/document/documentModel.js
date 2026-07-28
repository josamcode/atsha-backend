/**
 * Shared document contract — the layout-v2 document model.
 *
 * SHARED MODULE (see units.js for the mirroring rules).
 *
 * A template carries two co-operating halves:
 *
 *  - `sections[]` stays the SEMANTIC definition (section ids, field keys, types,
 *    labels, options, validation). Form values are keyed by
 *    `${section.id}.${field.key}` in every historical submission, so these ids
 *    are never rewritten by the redesign.
 *  - `document` is the VISUAL definition: an ordered list of placed blocks on a
 *    physical page. Section blocks reference a section by id; every other block
 *    owns its own content.
 *
 * Keeping them separate is what lets the data-entry screen stay responsive while
 * the printed document is paper-positioned, and it is what makes the v1 → v2
 * migration lossless and reversible.
 */

const { clampNumber, normalizePageSize, normalizeOrientation } = require('./units');

const DOCUMENT_VERSION = 2;
const SUPPORTED_DOCUMENT_VERSIONS = [2];
const GRID_COLUMNS = 24;

const BLOCK_TYPES = [
  'header',
  'metadata',
  'section',
  'signature',
  'footer',
  'text',
  'divider',
  'spacer',
  'image',
  'qr',
  'stamp',
  'watermark',
  'pageBreak'
];

const PLACEMENTS = ['flow', 'pageHeader', 'pageFooter', 'overlay'];
const REPEAT_MODES = ['all', 'first', 'notFirst'];

/** Blocks that may never be added twice to one document. */
const SINGLETON_BLOCK_TYPES = ['header', 'metadata', 'signature', 'footer', 'watermark'];

/** Default placement per block type. */
const DEFAULT_PLACEMENT = {
  header: 'pageHeader',
  footer: 'pageFooter',
  watermark: 'overlay',
  metadata: 'flow',
  section: 'flow',
  signature: 'flow',
  text: 'flow',
  divider: 'flow',
  spacer: 'flow',
  image: 'flow',
  qr: 'flow',
  stamp: 'flow',
  pageBreak: 'flow'
};

/** Blocks whose height is user-controlled rather than content-driven. */
const FIXED_HEIGHT_BLOCK_TYPES = ['spacer', 'image', 'qr', 'stamp', 'watermark'];

/** Blocks that can be dragged out of the flow onto the free overlay layer. */
const OVERLAY_CAPABLE_BLOCK_TYPES = ['image', 'qr', 'stamp', 'watermark', 'text'];

const localized = (value) => ({
  en: typeof value === 'string' ? value : (typeof value?.en === 'string' ? value.en : ''),
  ar: typeof value?.ar === 'string' ? value.ar : (typeof value === 'string' ? value : '')
});

let idCounter = 0;
/**
 * Deterministic-ish unique id. `seed` lets migrations and tests produce stable
 * ids; without it we fall back to a monotonic counter plus a random suffix.
 */
const createId = (prefix, seed) => {
  if (seed !== undefined && seed !== null && seed !== '') {
    return `${prefix}_${seed}`;
  }
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeBlockType = (type) => (BLOCK_TYPES.includes(type) ? type : 'text');

const normalizePlacement = (placement, type) => {
  if (PLACEMENTS.includes(placement)) {
    if (placement === 'overlay' && !OVERLAY_CAPABLE_BLOCK_TYPES.includes(type)) {
      return DEFAULT_PLACEMENT[type] || 'flow';
    }
    return placement;
  }
  return DEFAULT_PLACEMENT[type] || 'flow';
};

const getDefaultBlockProps = (type) => {
  switch (type) {
    case 'text':
      return {
        content: { en: '', ar: '' },
        fontSize: 11,
        bold: false,
        italic: false,
        align: 'start',
        color: '',
        backgroundColor: '',
        lineSpacing: 1.35
      };
    case 'divider':
      return { thickness: 1, color: '', style: 'solid', insetMm: 0 };
    case 'spacer':
      return {};
    case 'image':
      return {
        url: '',
        fit: 'contain',
        align: 'center',
        borderRadius: 0,
        borderWidth: 0,
        borderColor: '#d1d5db',
        backgroundColor: '',
        opacity: 100
      };
    case 'qr':
      return { value: '', foreground: '', background: '#ffffff', caption: { en: '', ar: '' } };
    case 'stamp':
      return { url: '', label: { en: '', ar: '' }, rotation: -12, opacity: 100, borderColor: '' };
    case 'watermark':
      return { url: '', opacity: 5, sizePercent: 55, rotation: 10 };
    default:
      return {};
  }
};

const getDefaultBlockSize = (type) => {
  switch (type) {
    case 'spacer':
      return { w: GRID_COLUMNS, heightMm: 8 };
    case 'divider':
      return { w: GRID_COLUMNS, heightMm: null };
    case 'image':
      return { w: 8, heightMm: 40 };
    case 'qr':
      return { w: 6, heightMm: 30 };
    case 'stamp':
      return { w: 6, heightMm: 30 };
    case 'watermark':
      return { w: GRID_COLUMNS, heightMm: null };
    case 'text':
      return { w: GRID_COLUMNS, heightMm: null };
    default:
      return { w: GRID_COLUMNS, heightMm: null };
  }
};

const normalizeOverlay = (overlay, type) => {
  const source = overlay || {};
  return {
    pageScope: source.pageScope === 'first' ? 'first' : 'all',
    xMm: clampNumber(source.xMm, 20, -500, 1000),
    yMm: clampNumber(source.yMm, 20, -500, 1000),
    wMm: clampNumber(source.wMm, type === 'watermark' ? 120 : 40, 3, 1000),
    hMm: clampNumber(source.hMm, type === 'watermark' ? 120 : 40, 3, 1000),
    rotation: clampNumber(source.rotation, type === 'watermark' ? 10 : 0, -180, 180),
    opacity: clampNumber(source.opacity, type === 'watermark' ? 5 : 100, 0, 100)
  };
};

const createBlock = (type, overrides = {}) => {
  const blockType = normalizeBlockType(type);
  const size = getDefaultBlockSize(blockType);
  const placement = normalizePlacement(overrides.placement, blockType);

  // Only keys the caller actually provided may override a default. Spreading the
  // raw object would let an explicit `undefined` (very easy to produce from an
  // optional action field) wipe out a computed default such as the placement.
  const provided = Object.keys(overrides).reduce((acc, key) => {
    // `type` and `placement` are already normalised above; taking them from the
    // raw overrides again would reintroduce whatever invalid value was passed.
    if (overrides[key] !== undefined && key !== 'type' && key !== 'placement') {
      acc[key] = overrides[key];
    }
    return acc;
  }, {});

  return {
    id: createId('blk'),
    x: 0,
    w: size.w,
    row: 0,
    heightMm: size.heightMm,
    minHeightMm: 0,
    hidden: false,
    locked: false,
    keepTogether: blockType === 'signature',
    breakBefore: false,
    repeat: 'all',
    refId: null,
    ...provided,
    type: blockType,
    placement,
    // Normalised AFTER the spread: a caller-supplied overlay is partial far more
    // often than not, and letting it through raw produced undefined millimetres.
    overlay: placement === 'overlay' ? normalizeOverlay(provided.overlay, blockType) : null,
    props: { ...getDefaultBlockProps(blockType), ...(provided.props || {}) }
  };
};

const normalizeBlock = (block, index) => {
  const type = normalizeBlockType(block?.type);
  const placement = normalizePlacement(block?.placement, type);
  const defaults = getDefaultBlockSize(type);
  const defaultProps = getDefaultBlockProps(type);
  const supportsFixedHeight = FIXED_HEIGHT_BLOCK_TYPES.includes(type);

  const x = Math.round(clampNumber(block?.x, 0, 0, GRID_COLUMNS - 1));
  const w = Math.round(clampNumber(block?.w, defaults.w, 1, GRID_COLUMNS));

  const props = { ...defaultProps, ...(block?.props || {}) };
  if (Object.prototype.hasOwnProperty.call(defaultProps, 'content')) {
    props.content = localized(props.content);
  }
  if (Object.prototype.hasOwnProperty.call(defaultProps, 'caption')) {
    props.caption = localized(props.caption);
  }
  if (Object.prototype.hasOwnProperty.call(defaultProps, 'label')) {
    props.label = localized(props.label);
  }

  let heightMm = null;
  if (supportsFixedHeight) {
    heightMm = clampNumber(block?.heightMm, defaults.heightMm == null ? 20 : defaults.heightMm, 1, 1000);
  } else if (block?.heightMm != null && Number.isFinite(Number(block.heightMm))) {
    heightMm = clampNumber(block.heightMm, 0, 0, 1000) || null;
  }

  return {
    id: block?.id || createId('blk', `${index}`),
    type,
    placement,
    x: Math.min(x, GRID_COLUMNS - 1),
    w: Math.min(w, GRID_COLUMNS - Math.min(x, GRID_COLUMNS - 1)),
    row: Math.round(clampNumber(block?.row, index, 0, 100000)),
    heightMm,
    minHeightMm: clampNumber(block?.minHeightMm, 0, 0, 1000),
    hidden: block?.hidden === true,
    locked: block?.locked === true,
    keepTogether: block?.keepTogether === true,
    breakBefore: block?.breakBefore === true,
    repeat: REPEAT_MODES.includes(block?.repeat) ? block.repeat : 'all',
    refId: typeof block?.refId === 'string' && block.refId ? block.refId : null,
    overlay: placement === 'overlay' ? normalizeOverlay(block?.overlay, type) : null,
    props
  };
};

const getDefaultDocument = () => ({
  version: DOCUMENT_VERSION,
  page: {
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 14, right: 12, bottom: 14, left: 12 }
  },
  grid: {
    columns: GRID_COLUMNS,
    gutterMm: 3,
    rowGapMm: 3,
    snap: true,
    showGrid: true
  },
  blocks: []
});

/**
 * Re-packs flow blocks so `row` values are contiguous and blocks inside a row are
 * ordered by their logical x. Row identity is preserved (side-by-side blocks stay
 * side by side); only the numbering is compacted.
 */
const compactRows = (blocks) => {
  const flow = blocks.filter((block) => block.placement === 'flow');
  const others = blocks.filter((block) => block.placement !== 'flow');

  const sorted = [...flow].sort((a, b) => (a.row - b.row) || (a.x - b.x));
  let nextRow = 0;
  let previousRow = null;
  const repacked = sorted.map((block) => {
    if (previousRow === null) {
      previousRow = block.row;
    } else if (block.row !== previousRow) {
      previousRow = block.row;
      nextRow += 1;
    }
    return { ...block, row: nextRow };
  });

  return [...repacked, ...others];
};

const normalizeDocument = (input) => {
  const defaults = getDefaultDocument();
  const source = input || {};
  const rawMargins = source.page?.margins || {};

  const blocks = Array.isArray(source.blocks) ? source.blocks.map(normalizeBlock) : [];

  // Collapse accidental duplicates of the singleton blocks (can only arise from
  // hand-edited data); the first occurrence wins.
  const seenSingletons = new Set();
  const deduped = blocks.filter((block) => {
    if (!SINGLETON_BLOCK_TYPES.includes(block.type)) {
      return true;
    }
    if (seenSingletons.has(block.type)) {
      return false;
    }
    seenSingletons.add(block.type);
    return true;
  });

  return {
    version: DOCUMENT_VERSION,
    page: {
      size: normalizePageSize(source.page?.size),
      orientation: normalizeOrientation(source.page?.orientation),
      margins: {
        top: clampNumber(rawMargins.top, defaults.page.margins.top, 0, 100),
        right: clampNumber(rawMargins.right, defaults.page.margins.right, 0, 100),
        bottom: clampNumber(rawMargins.bottom, defaults.page.margins.bottom, 0, 100),
        left: clampNumber(rawMargins.left, defaults.page.margins.left, 0, 100)
      }
    },
    grid: {
      columns: GRID_COLUMNS,
      gutterMm: clampNumber(source.grid?.gutterMm, defaults.grid.gutterMm, 0, 20),
      rowGapMm: clampNumber(source.grid?.rowGapMm, defaults.grid.rowGapMm, 0, 40),
      snap: source.grid?.snap !== false,
      showGrid: source.grid?.showGrid !== false
    },
    blocks: compactRows(deduped)
  };
};

/**
 * Version gate. Unsupported (typically future) documents must fail loudly rather
 * than being silently coerced into something the renderer can draw.
 */
const assertSupportedDocumentVersion = (documentValue) => {
  const version = Number(documentValue?.version);
  if (!Number.isFinite(version)) {
    return { ok: true, version: DOCUMENT_VERSION };
  }
  if (!SUPPORTED_DOCUMENT_VERSIONS.includes(version)) {
    return {
      ok: false,
      version,
      code: 'unsupported_document_version',
      message: `Unsupported document layout version ${version}. This template was saved by a newer version of the Template Builder.`,
      messageAr: `إصدار تخطيط المستند ${version} غير مدعوم. تم حفظ هذا النموذج بإصدار أحدث من مصمم النماذج.`
    };
  }
  return { ok: true, version };
};

const getFlowBlocks = (documentValue) => (documentValue?.blocks || [])
  .filter((block) => block.placement === 'flow')
  .sort((a, b) => (a.row - b.row) || (a.x - b.x));

const getBlocksByPlacement = (documentValue, placement) => (documentValue?.blocks || [])
  .filter((block) => block.placement === placement);

const findBlockById = (documentValue, blockId) => (documentValue?.blocks || [])
  .find((block) => block.id === blockId) || null;

module.exports = {
  DOCUMENT_VERSION,
  SUPPORTED_DOCUMENT_VERSIONS,
  GRID_COLUMNS,
  BLOCK_TYPES,
  PLACEMENTS,
  REPEAT_MODES,
  SINGLETON_BLOCK_TYPES,
  FIXED_HEIGHT_BLOCK_TYPES,
  OVERLAY_CAPABLE_BLOCK_TYPES,
  DEFAULT_PLACEMENT,
  createId,
  createBlock,
  normalizeBlock,
  normalizeOverlay,
  getDefaultBlockProps,
  getDefaultBlockSize,
  getDefaultDocument,
  normalizeDocument,
  compactRows,
  assertSupportedDocumentVersion,
  getFlowBlocks,
  getBlocksByPlacement,
  findBlockById
};
