/**
 * Shared document contract — deterministic text measurement.
 *
 * SHARED MODULE (see units.js for the mirroring rules).
 *
 * Line breaking has to produce the *same* result in the browser canvas, in the
 * print view and in the server PDF, otherwise pagination diverges between
 * consumers. Measuring with the DOM would make the browser authoritative and the
 * server unable to agree, so measurement is done here with a fixed advance-width
 * table and both renderers position the resulting lines explicitly.
 *
 * Latin widths are the Helvetica / Helvetica-Bold AFM advance widths (units per
 * 1000 em) which are exactly what PDFKit uses for the built-in fonts. Arabic and
 * other scripts use a calibrated average advance because the embedded Arabic
 * face is shaped at render time.
 */

const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

/**
 * Average advance for scripts rendered with the embedded Arabic face.
 *
 * Calibrated against PDFKit + Noto Sans Arabic (`fonts/NotoSansArabic-*.ttf`)
 * over representative Arabic strings: this value is deliberately ~4% wider than
 * the measured mean so the estimate errs towards reserving too much room. Under-
 * estimating would let a shaped line overflow the box it was measured into.
 */
const ARABIC_ADVANCE = 480;
const ARABIC_BOLD_ADVANCE = 515;
/** Fallback for anything outside Latin-1 / Arabic (CJK, symbols, emoji…). */
const FALLBACK_ADVANCE = 600;

const ARABIC_RANGES = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff]
];

/** Combining marks carry no advance of their own. */
const ZERO_WIDTH_RANGES = [
  [0x0300, 0x036f],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x200b, 0x200f],
  [0xfe00, 0xfe0f]
];

const inRanges = (code, ranges) => {
  for (let i = 0; i < ranges.length; i += 1) {
    if (code >= ranges[i][0] && code <= ranges[i][1]) {
      return true;
    }
  }
  return false;
};

const isArabicCode = (code) => inRanges(code, ARABIC_RANGES);
const isZeroWidthCode = (code) => inRanges(code, ZERO_WIDTH_RANGES);

const containsArabic = (text) => {
  const value = String(text == null ? '' : text);
  for (let i = 0; i < value.length; i += 1) {
    if (isArabicCode(value.charCodeAt(i))) {
      return true;
    }
  }
  return false;
};

const advanceForCode = (code, bold) => {
  if (isZeroWidthCode(code)) {
    return 0;
  }
  if (code >= 32 && code <= 126) {
    return bold ? HELVETICA_BOLD_WIDTHS[code - 32] : HELVETICA_WIDTHS[code - 32];
  }
  if (isArabicCode(code)) {
    return bold ? ARABIC_BOLD_ADVANCE : ARABIC_ADVANCE;
  }
  if (code === 9) {
    return bold ? HELVETICA_BOLD_WIDTHS[0] * 4 : HELVETICA_WIDTHS[0] * 4;
  }
  if (code >= 0x00a0 && code <= 0x00ff) {
    return bold ? 556 : 556;
  }
  return FALLBACK_ADVANCE;
};

/** Advance width of `text` at `fontSize` points. */
const measureText = (text, options = {}) => {
  const fontSize = Number(options.fontSize) || 10;
  const bold = Boolean(options.bold);
  const value = String(text == null ? '' : text);
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    total += advanceForCode(value.charCodeAt(i), bold);
  }
  return (total / 1000) * fontSize;
};

/**
 * Break a token that cannot fit on one line.
 *
 * Widths accumulate per character instead of re-measuring the whole prefix each
 * time — the naive version is O(n²) and a single pasted 50k-character token was
 * enough to make a server export burn seconds of CPU.
 */
const breakLongToken = (token, maxWidth, options) => {
  const fontSize = Number(options.fontSize) || 10;
  const bold = Boolean(options.bold);
  const pieces = [];
  let start = 0;
  let width = 0;

  for (let i = 0; i < token.length; i += 1) {
    const advance = (advanceForCode(token.charCodeAt(i), bold) / 1000) * fontSize;
    if (width > 0 && width + advance > maxWidth) {
      pieces.push(token.slice(start, i));
      start = i;
      width = advance;
    } else {
      width += advance;
    }
  }
  pieces.push(token.slice(start));
  return pieces.length > 0 ? pieces : [''];
};

/**
 * Greedy word wrap. Honours explicit newlines, breaks over-long tokens and never
 * returns fewer than one line so an empty value still reserves its row height.
 *
 * Line width is tracked incrementally so wrapping is linear in the input length.
 */
const wrapText = (text, maxWidth, options = {}) => {
  const value = String(text == null ? '' : text);
  const width = Number(maxWidth) || 0;
  if (width <= 0) {
    return value ? [value] : [''];
  }

  const fontSize = Number(options.fontSize) || 10;
  const bold = Boolean(options.bold);
  const spaceWidth = (advanceForCode(32, bold) / 1000) * fontSize;

  const lines = [];
  const paragraphs = value.split(/\r\n|\r|\n/);

  paragraphs.forEach((paragraph) => {
    const tokens = paragraph.split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      lines.push('');
      return;
    }

    let current = '';
    let currentWidth = 0;

    tokens.forEach((token) => {
      const tokenWidth = measureText(token, { fontSize, bold });
      const candidateWidth = current ? currentWidth + spaceWidth + tokenWidth : tokenWidth;

      if (candidateWidth <= width) {
        current = current ? `${current} ${token}` : token;
        currentWidth = candidateWidth;
        return;
      }

      if (current) {
        lines.push(current);
        current = '';
        currentWidth = 0;
      }

      if (tokenWidth > width) {
        const pieces = breakLongToken(token, width, { fontSize, bold });
        for (let i = 0; i < pieces.length - 1; i += 1) {
          lines.push(pieces[i]);
        }
        current = pieces[pieces.length - 1];
        currentWidth = measureText(current, { fontSize, bold });
      } else {
        current = token;
        currentWidth = tokenWidth;
      }
    });

    lines.push(current);
  });

  return lines.length > 0 ? lines : [''];
};

/** Line box height used by both renderers. */
const lineHeight = (fontSize, lineSpacing = 1.25) => (Number(fontSize) || 10) * (Number(lineSpacing) || 1.25);

/** Wrap and report the block height in one call. */
const layoutParagraph = (text, maxWidth, options = {}) => {
  const fontSize = Number(options.fontSize) || 10;
  const spacing = Number(options.lineSpacing) || 1.25;
  const lines = wrapText(text, maxWidth, options);

  return {
    lines,
    lineHeight: lineHeight(fontSize, spacing),
    height: lines.length * lineHeight(fontSize, spacing)
  };
};

module.exports = {
  measureText,
  wrapText,
  layoutParagraph,
  lineHeight,
  containsArabic,
  ARABIC_ADVANCE,
  FALLBACK_ADVANCE
};
