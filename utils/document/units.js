/**
 * Shared document contract — physical units and page geometry.
 *
 * SHARED MODULE. The canonical copy lives in `frontend/src/document/`.
 * `backend/utils/document/` holds a byte-identical mirror produced by
 * `backend/scripts/syncDocumentContract.js`. Keep this file CommonJS and free of
 * any browser or Node specific API so both runtimes can load it unchanged.
 *
 * All internal geometry is expressed in PostScript points (pt, 1/72 inch)
 * because that is the unit PDFKit draws in. Author-facing values (page margins,
 * overlay placement) are stored in millimetres because that is what template
 * authors reason about on paper.
 */

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

const PAGE_SIZES_MM = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 }
};

const PAGE_SIZE_VALUES = Object.keys(PAGE_SIZES_MM);
const ORIENTATION_VALUES = ['portrait', 'landscape'];

const mmToPt = (mm) => (Number(mm) || 0) * (PT_PER_INCH / MM_PER_INCH);
const ptToMm = (pt) => (Number(pt) || 0) * (MM_PER_INCH / PT_PER_INCH);
const mmToPx = (mm, dpi = 96) => (Number(mm) || 0) * (dpi / MM_PER_INCH);
const ptToPx = (pt, dpi = 96) => (Number(pt) || 0) * (dpi / PT_PER_INCH);

const roundTo = (value, decimals = 3) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const clampNumber = (value, fallback, min, max) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  if (Number.isFinite(min) && numericValue < min) {
    return min;
  }
  if (Number.isFinite(max) && numericValue > max) {
    return max;
  }
  return numericValue;
};

const normalizePageSize = (value) => (PAGE_SIZE_VALUES.includes(value) ? value : 'A4');
const normalizeOrientation = (value) => (ORIENTATION_VALUES.includes(value) ? value : 'portrait');

/**
 * Physical page box for a page configuration.
 * Margins are millimetres; every returned measurement is points.
 */
const getPageGeometry = (page = {}) => {
  const size = normalizePageSize(page.size);
  const orientation = normalizeOrientation(page.orientation);
  const base = PAGE_SIZES_MM[size];

  const widthMm = orientation === 'landscape' ? base.height : base.width;
  const heightMm = orientation === 'landscape' ? base.width : base.height;

  const widthPt = mmToPt(widthMm);
  const heightPt = mmToPt(heightMm);

  const rawMargins = page.margins || {};
  // Margins may never eat the whole sheet: leave at least 10mm of content.
  const maxHorizontal = Math.max(0, (widthMm - 10) / 2);
  const maxVertical = Math.max(0, (heightMm - 10) / 2);

  const marginsMm = {
    top: clampNumber(rawMargins.top, 12, 0, maxVertical),
    right: clampNumber(rawMargins.right, 12, 0, maxHorizontal),
    bottom: clampNumber(rawMargins.bottom, 12, 0, maxVertical),
    left: clampNumber(rawMargins.left, 12, 0, maxHorizontal)
  };

  const marginsPt = {
    top: mmToPt(marginsMm.top),
    right: mmToPt(marginsMm.right),
    bottom: mmToPt(marginsMm.bottom),
    left: mmToPt(marginsMm.left)
  };

  return {
    size,
    orientation,
    widthMm,
    heightMm,
    widthPt,
    heightPt,
    marginsMm,
    marginsPt,
    contentXPt: marginsPt.left,
    contentYPt: marginsPt.top,
    contentWidthPt: Math.max(1, widthPt - marginsPt.left - marginsPt.right),
    contentHeightPt: Math.max(1, heightPt - marginsPt.top - marginsPt.bottom)
  };
};

module.exports = {
  MM_PER_INCH,
  PT_PER_INCH,
  PAGE_SIZES_MM,
  PAGE_SIZE_VALUES,
  ORIENTATION_VALUES,
  mmToPt,
  ptToMm,
  mmToPx,
  ptToPx,
  roundTo,
  clampNumber,
  normalizePageSize,
  normalizeOrientation,
  getPageGeometry
};
