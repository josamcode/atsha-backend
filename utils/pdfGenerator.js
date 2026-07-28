const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const QRCode = require('qrcode');

const { layoutDocument } = require('./document/layoutEngine');
const { resolveTemplateContract } = require('./document/templateContract');
const { containsArabic } = require('./document/textMetrics');

/**
 * Server-side PDF generation.
 *
 * This module no longer implements its own layout. `document/layoutEngine`
 * produces a paginated list of absolutely positioned draw primitives, and this
 * file is a thin PDFKit executor for them — exactly the same primitives the
 * browser canvas, the preview and the print view execute. That is what makes
 * "what you designed" and "what you downloaded" the same document by
 * construction rather than by two implementations agreeing.
 */

const MAX_IMAGE_BYTES = Number(process.env.PDF_MAX_IMAGE_BYTES) || 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = Number(process.env.PDF_IMAGE_TIMEOUT_MS) || 12000;
const MAX_CONCURRENT_IMAGE_LOADS = 4;
/** Whole-document budgets, so one template cannot exhaust the export worker. */
const MAX_TOTAL_IMAGE_BYTES = Number(process.env.PDF_MAX_TOTAL_IMAGE_BYTES) || 48 * 1024 * 1024;
const MAX_DISTINCT_IMAGES = Number(process.env.PDF_MAX_IMAGES) || 60;
/** Absolute ceiling on a single fetch, independent of socket inactivity. */
const IMAGE_TOTAL_TIMEOUT_MS = Number(process.env.PDF_IMAGE_TOTAL_TIMEOUT_MS) || 20000;

const UPLOADS_ROOT = path.resolve(__dirname, '..', 'uploads');

/**
 * Hosts that must never be fetched server-side.
 *
 * Image URLs arrive from template branding AND from submitted form values, so
 * they are attacker-controlled: without this an employee could point a field at
 * a cloud metadata endpoint or an internal service and read the response through
 * the exported PDF. Mirrors the policy already enforced by `routes/media.js`.
 */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^169\.254\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\./i
];

const isBlockedHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host));
};

/** True when the URL is safe for the server to fetch. */
const isFetchableUrl = (value) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    return !isBlockedHost(parsed.hostname);
  } catch (error) {
    return false;
  }
};

const ARABIC_REGULAR_PATH = process.env.PDF_ARABIC_FONT_PATH
  || path.join(__dirname, '..', 'fonts', 'NotoSansArabic-Regular.ttf');
const ARABIC_BOLD_PATH = process.env.PDF_ARABIC_BOLD_FONT_PATH
  || path.join(__dirname, '..', 'fonts', 'NotoSansArabic-Bold.ttf');

const clampNumber = (value, fallback, min, max) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
};

/**
 * Download an image from a URL and return it as a Buffer.
 * Follows redirects (max 3 hops), enforces a hard byte budget and actually tears
 * down a stalled socket — the previous `timeout` option only armed an event.
 */
const downloadImage = (url, redirectCount = 0, deadline = Date.now() + IMAGE_TOTAL_TIMEOUT_MS) => new Promise((resolve, reject) => {
  if (redirectCount > 3) {
    reject(new Error('Too many redirects'));
    return;
  }
  // Re-checked on every hop: a redirect is the classic way to smuggle a request
  // to an internal host past a check that only ran on the first URL.
  if (!isFetchableUrl(url)) {
    reject(new Error(`Refusing to fetch ${url}: host is not allowed`));
    return;
  }
  if (Date.now() > deadline) {
    reject(new Error(`Timed out downloading image from ${url}`));
    return;
  }

  const client = String(url).startsWith('https') ? https : http;
  const overallTimer = setTimeout(() => {
    // eslint-disable-next-line no-use-before-define
    request.destroy(new Error(`Timed out downloading image from ${url}`));
  }, Math.max(1, deadline - Date.now()));

  const request = client.get(url, { timeout: IMAGE_TIMEOUT_MS }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      clearTimeout(overallTimer);
      const next = new URL(response.headers.location, url).toString();
      downloadImage(next, redirectCount + 1, deadline).then(resolve).catch(reject);
      return;
    }

    if (response.statusCode !== 200) {
      response.resume();
      reject(new Error(`Failed to download image from ${url}: HTTP ${response.statusCode}`));
      return;
    }

    const declaredLength = Number(response.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      response.destroy();
      reject(new Error(`Image at ${url} exceeds the ${MAX_IMAGE_BYTES} byte budget`));
      return;
    }

    const chunks = [];
    let received = 0;
    response.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_IMAGE_BYTES) {
        response.destroy();
        reject(new Error(`Image at ${url} exceeds the ${MAX_IMAGE_BYTES} byte budget`));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => {
      clearTimeout(overallTimer);
      resolve(Buffer.concat(chunks));
    });
    response.on('error', (error) => {
      clearTimeout(overallTimer);
      reject(error);
    });
  });

  request.on('timeout', () => {
    request.destroy(new Error(`Timed out downloading image from ${url}`));
  });
  request.on('error', (error) => {
    clearTimeout(overallTimer);
    reject(error);
  });
});

/**
 * Resolve an image path/URL to a Buffer suitable for PDFKit.
 * Handles: absolute URLs, /uploads/* local paths, static files, data URIs.
 */
const resolveAndLoadImage = async (imageUrl) => {
  if (!imageUrl) {
    return null;
  }

  const urlStr = String(imageUrl).trim();

  // Data URI — PDFKit can handle these directly
  if (urlStr.startsWith('data:')) {
    // PDFKit cannot decode SVG; the preview placeholder uses one, so skip it
    // rather than throwing in the middle of a page.
    if (/^data:image\/svg\+xml/i.test(urlStr)) {
      return null;
    }
    return urlStr;
  }

  // Absolute URL — download it (host-checked, redirect-checked, size-capped)
  if (/^https?:\/\//i.test(urlStr)) {
    try {
      return await downloadImage(urlStr);
    } catch (err) {
      console.warn(`[pdfGenerator] Failed to download image from ${urlStr}:`, err.message);
      return null;
    }
  }

  /**
   * Local files. The path is resolved and then CONTAINED inside `uploads/`:
   * image references come from submitted form values, so `/uploads/../../..`
   * would otherwise read any file the process can see and embed it in the PDF.
   */
  const relative = urlStr.replace(/^\/+/, '').replace(/^uploads\//, '');
  const resolved = path.resolve(UPLOADS_ROOT, relative);
  if (resolved !== UPLOADS_ROOT && !resolved.startsWith(UPLOADS_ROOT + path.sep)) {
    console.warn(`[pdfGenerator] Refusing to read ${urlStr}: outside the uploads directory`);
    return null;
  }

  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const stats = fs.statSync(resolved);
      if (stats.size > MAX_IMAGE_BYTES) {
        console.warn(`[pdfGenerator] Skipping ${urlStr}: exceeds the image size budget`);
        return null;
      }
      return fs.readFileSync(resolved);
    }
  } catch (err) {
    console.warn(`[pdfGenerator] Failed to read local file ${resolved}:`, err.message);
  }

  return null;
};

/** Run `worker` over `items` with a bounded number of in-flight promises. */
const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
};

const normalizeColor = (value, fallback = null) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'transparent') return fallback;
  // PDFKit accepts #rgb/#rrggbb and named colours but not rgba(); drop the alpha.
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(trimmed);
  if (rgba) {
    const toHex = (component) => Math.max(0, Math.min(255, Math.round(Number(component))))
      .toString(16)
      .padStart(2, '0');
    return `#${toHex(rgba[1])}${toHex(rgba[2])}${toHex(rgba[3])}`;
  }
  return trimmed;
};

class PDFGenerator {
  constructor() {
    this.arabicFontPath = ARABIC_REGULAR_PATH;
    this.arabicBoldFontPath = ARABIC_BOLD_PATH;
    this.warnedMissingArabicFont = false;
  }

  buildPdfStyle(template = {}, organization = null) {
    const templatePdfStyle = template.pdfStyle || {};
    const templateBranding = templatePdfStyle.branding || {};
    const organizationBranding = organization?.branding || {};
    const organizationDisplayName = organizationBranding.displayName || organization?.name || 'AraRM';

    return {
      ...templatePdfStyle,
      branding: {
        ...templateBranding,
        primaryColor: templateBranding.primaryColor || organizationBranding.primaryColor || templatePdfStyle.colors?.primary || '#d4b900',
        secondaryColor: templateBranding.secondaryColor || organizationBranding.secondaryColor || '#b51c20',
        logoUrl: templateBranding.logoUrl || organizationBranding.logoUrl,
        companyName: {
          en: templateBranding.companyName?.en || organizationDisplayName,
          ar: templateBranding.companyName?.ar || organizationDisplayName
        },
        companyAddress: {
          en: templateBranding.companyAddress?.en || organizationBranding.legalName || '',
          ar: templateBranding.companyAddress?.ar || organizationBranding.legalName || ''
        },
        watermarkUrl: templateBranding.watermarkUrl || organizationBranding.watermarkUrl,
        companyPhone: templateBranding.companyPhone || organizationBranding.supportPhone,
        companyEmail: templateBranding.companyEmail || organizationBranding.supportEmail
      }
    };
  }

  getDepartmentLabel(organization, departmentCode, language = 'en') {
    const normalizedCode = String(departmentCode || '').trim().toLowerCase();
    const department = (organization?.departments || []).find((entry) => entry.code === normalizedCode);

    if (department?.name?.[language]) {
      return department.name[language];
    }

    if (department?.name?.en) {
      return department.name.en;
    }

    return departmentCode || '-';
  }

  /**
   * Register the embedded Arabic faces. PDFKit's built-in Type1 fonts are
   * WinAnsi-only and carry no Arabic glyphs or shaping tables; fontkit shapes
   * Arabic correctly once a real TTF is registered.
   */
  registerFonts(doc) {
    const available = { arabic: false, arabicBold: false };

    try {
      if (fs.existsSync(this.arabicFontPath)) {
        doc.registerFont('Arabic', this.arabicFontPath);
        available.arabic = true;
      }
      if (fs.existsSync(this.arabicBoldFontPath)) {
        doc.registerFont('Arabic-Bold', this.arabicBoldFontPath);
        available.arabicBold = true;
      }
    } catch (error) {
      console.warn('[pdfGenerator] Could not register the Arabic font:', error.message);
    }

    if (!available.arabic && !this.warnedMissingArabicFont) {
      this.warnedMissingArabicFont = true;
      console.warn(
        `[pdfGenerator] Arabic font not found at ${this.arabicFontPath}. `
        + 'Arabic text will fall back to Helvetica and will not render correctly. '
        + 'Set PDF_ARABIC_FONT_PATH or ship fonts/NotoSansArabic-Regular.ttf.'
      );
    }

    return available;
  }

  /** Pick a face per line: Noto Sans Arabic also covers Latin, so mixed lines are safe. */
  selectFont(doc, text, bold, fonts) {
    if (containsArabic(text) && fonts.arabic) {
      doc.font(bold && fonts.arabicBold ? 'Arabic-Bold' : 'Arabic');
      return;
    }
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  }

  /** Collect every distinct image source and QR value so they load once, in parallel. */
  async preloadAssets(pages) {
    const imageSources = new Set();
    const qrEntries = new Map();

    pages.forEach((page) => {
      page.primitives.forEach((primitive) => {
        if (primitive.k === 'image' && primitive.src) {
          imageSources.add(primitive.src);
        }
        if (primitive.k === 'qr' && primitive.value) {
          const key = `${primitive.value}|${primitive.foreground}|${primitive.background}|${Math.round(primitive.size)}`;
          if (!qrEntries.has(key)) {
            qrEntries.set(key, primitive);
          }
        }
      });
    });

    // Bound both the count and the total bytes held in memory at once: the
    // per-image cap alone still allows an arbitrary number of images.
    const allSources = [...imageSources];
    const sources = allSources.slice(0, MAX_DISTINCT_IMAGES);
    if (allSources.length > sources.length) {
      console.warn(
        `[pdfGenerator] Document references ${allSources.length} distinct images; `
        + `only the first ${MAX_DISTINCT_IMAGES} are embedded.`
      );
    }

    const loaded = await mapWithConcurrency(sources, MAX_CONCURRENT_IMAGE_LOADS, (src) => resolveAndLoadImage(src));
    const images = new Map();
    let totalBytes = 0;
    sources.forEach((src, index) => {
      const buffer = loaded[index];
      if (!buffer) return;
      const size = Buffer.isBuffer(buffer) ? buffer.length : String(buffer).length;
      if (totalBytes + size > MAX_TOTAL_IMAGE_BYTES) {
        console.warn(`[pdfGenerator] Image budget exhausted; skipping ${src}`);
        return;
      }
      totalBytes += size;
      images.set(src, buffer);
    });

    const qrKeys = [...qrEntries.keys()];
    const qrBuffers = await mapWithConcurrency(qrKeys, MAX_CONCURRENT_IMAGE_LOADS, async (key) => {
      const primitive = qrEntries.get(key);
      try {
        return await QRCode.toBuffer(String(primitive.value), {
          margin: 1,
          width: Math.max(120, Math.round(primitive.size * 3)),
          color: {
            dark: normalizeColor(primitive.foreground, '#000000'),
            light: normalizeColor(primitive.background, '#ffffff') || '#ffffff'
          }
        });
      } catch (error) {
        console.warn('[pdfGenerator] QR generation failed:', error.message);
        return null;
      }
    });

    const qrCodes = new Map();
    qrKeys.forEach((key, index) => {
      if (qrBuffers[index]) {
        qrCodes.set(key, qrBuffers[index]);
      }
    });

    return { images, qrCodes };
  }

  drawRect(doc, primitive) {
    const fill = normalizeColor(primitive.fill);
    const stroke = normalizeColor(primitive.stroke);
    if (!fill && !stroke) return;

    const radius = clampNumber(primitive.radius, 0, 0, Math.min(primitive.w, primitive.h) / 2);
    doc.save();
    // The browser executor applies `transform: rotate()` to rotated rects, so the
    // PDF has to do the same or a stamp outline is straight in one and tilted in
    // the other.
    const rotation = clampNumber(primitive.rotation, 0, -180, 180);
    if (rotation) {
      doc.rotate(rotation, { origin: [primitive.x + primitive.w / 2, primitive.y + primitive.h / 2] });
    }
    if (radius > 0) {
      doc.roundedRect(primitive.x, primitive.y, primitive.w, primitive.h, radius);
    } else {
      doc.rect(primitive.x, primitive.y, primitive.w, primitive.h);
    }

    if (primitive.dash) {
      doc.dash(primitive.dash[0], { space: primitive.dash[1] });
    }

    if (fill && stroke) {
      doc.lineWidth(primitive.strokeWidth || 1).fillAndStroke(fill, stroke);
    } else if (fill) {
      doc.fill(fill);
    } else {
      doc.lineWidth(primitive.strokeWidth || 1).stroke(stroke);
    }
    doc.undash();
    doc.restore();
  }

  drawLine(doc, primitive) {
    const stroke = normalizeColor(primitive.stroke, '#000000');
    doc.save();
    if (primitive.dash) {
      doc.dash(primitive.dash[0], { space: primitive.dash[1] });
    }
    doc.moveTo(primitive.x1, primitive.y1)
      .lineTo(primitive.x2, primitive.y2)
      .lineWidth(Math.max(0.1, primitive.width || 1))
      .stroke(stroke);
    doc.undash();
    doc.restore();
  }

  drawText(doc, primitive, fonts) {
    const color = normalizeColor(primitive.color, '#000000');
    const fontSize = Math.max(1, primitive.fontSize);
    // Centre the glyphs inside the engine's line box; the browser executor
    // applies the identical offset so baselines agree between renderers.
    const baselineOffset = Math.max(0, (primitive.lineHeight - fontSize) / 2);

    primitive.lines.forEach((line, index) => {
      if (!line) return;
      this.selectFont(doc, line, primitive.bold, fonts);
      doc.fontSize(fontSize).fillColor(color);

      const lineWidth = doc.widthOfString(line);
      let x = primitive.x;
      if (primitive.align === 'center') {
        x = primitive.x + Math.max(0, (primitive.w - lineWidth) / 2);
      } else if (primitive.align === 'right') {
        x = primitive.x + Math.max(0, primitive.w - lineWidth);
      }

      doc.text(line, x, primitive.y + index * primitive.lineHeight + baselineOffset, {
        lineBreak: false,
        width: Math.max(lineWidth, primitive.w)
      });
    });
  }

  drawImage(doc, primitive, images) {
    const source = images.get(primitive.src);
    if (!source) return;

    const opacity = primitive.opacity === undefined ? 1 : clampNumber(primitive.opacity, 1, 0, 1);
    const rotation = clampNumber(primitive.rotation, 0, -180, 180);

    doc.save();
    if (opacity < 1) {
      doc.opacity(opacity);
    }
    if (rotation) {
      doc.rotate(rotation, { origin: [primitive.x + primitive.w / 2, primitive.y + primitive.h / 2] });
    }

    if (primitive.backgroundColor) {
      const background = normalizeColor(primitive.backgroundColor);
      if (background) {
        doc.rect(primitive.x, primitive.y, primitive.w, primitive.h).fill(background);
      }
    }

    // Corner radius: the browser clips with `border-radius` + `overflow:hidden`,
    // so the PDF clips to the same rounded rectangle rather than drawing square.
    const radius = clampNumber(primitive.radius, 0, 0, Math.min(primitive.w, primitive.h) / 2);
    if (radius > 0) {
      doc.save();
      doc.roundedRect(primitive.x, primitive.y, primitive.w, primitive.h, radius).clip();
    }

    try {
      const options = primitive.fit === 'cover'
        ? { cover: [primitive.w, primitive.h], align: 'center', valign: 'center' }
        : (primitive.fit === 'fill'
          ? { width: primitive.w, height: primitive.h }
          : { fit: [primitive.w, primitive.h], align: 'center', valign: 'center' });
      doc.image(source, primitive.x, primitive.y, options);
    } catch (error) {
      console.warn('[pdfGenerator] Could not draw image:', error.message);
    }

    if (radius > 0) {
      doc.restore();
    }

    if (primitive.borderWidth > 0) {
      const borderColor = normalizeColor(primitive.borderColor, '#d1d5db');
      doc.lineWidth(primitive.borderWidth);
      if (radius > 0) {
        doc.roundedRect(primitive.x, primitive.y, primitive.w, primitive.h, radius).stroke(borderColor);
      } else {
        doc.rect(primitive.x, primitive.y, primitive.w, primitive.h).stroke(borderColor);
      }
    }

    doc.restore();
  }

  drawQr(doc, primitive, qrCodes) {
    const key = `${primitive.value}|${primitive.foreground}|${primitive.background}|${Math.round(primitive.size)}`;
    const buffer = qrCodes.get(key);
    if (!buffer) return;
    try {
      doc.image(buffer, primitive.x, primitive.y, { fit: [primitive.size, primitive.size] });
    } catch (error) {
      console.warn('[pdfGenerator] Could not draw QR code:', error.message);
    }
  }

  /**
   * Build a PDF for a submitted form.
   *
   * @returns {Promise<Buffer>}
   */
  async generateFormPDF(formInstance, template, user, language = 'en', options = {}) {
    const plainTemplate = template && typeof template.toObject === 'function'
      ? template.toObject()
      : template;

    if (!plainTemplate) {
      throw new Error('Cannot export a form whose template no longer exists');
    }

    const organization = options.organization || null;
    const normalizedLanguage = language === 'ar' ? 'ar' : 'en';

    const styledTemplate = {
      ...plainTemplate,
      pdfStyle: this.buildPdfStyle(plainTemplate, organization)
    };

    const contract = resolveTemplateContract(styledTemplate, { organization });
    if (!contract.ok) {
      const error = new Error(contract.error?.message || 'Unsupported template layout version');
      error.statusCode = 422;
      throw error;
    }

    const instance = formInstance && typeof formInstance.toObject === 'function'
      ? formInstance.toObject()
      : (formInstance || {});

    const result = layoutDocument({
      contract,
      values: instance.values || {},
      formInstance: instance,
      language: normalizedLanguage,
      mode: 'print',
      resolveDepartment: (code) => this.getDepartmentLabel(organization, code, normalizedLanguage)
    });

    if (!result.ok) {
      const error = new Error(result.error?.message || 'Could not lay out the document');
      error.statusCode = 422;
      throw error;
    }

    const assets = await this.preloadAssets(result.pages);
    const geometry = result.geometry;

    const doc = new PDFDocument({
      size: [geometry.widthPt, geometry.heightPt],
      margin: 0,
      autoFirstPage: false,
      info: {
        Title: contract.template.title?.[normalizedLanguage] || contract.template.title?.en || 'Form',
        Producer: 'AraRM Template Builder'
      }
    });

    const fonts = this.registerFonts(doc);

    const chunks = [];
    const finished = new Promise((resolve, reject) => {
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    result.pages.forEach((page) => {
      doc.addPage({ size: [geometry.widthPt, geometry.heightPt], margin: 0 });
      page.primitives.forEach((primitive) => {
        switch (primitive.k) {
          case 'rect':
            this.drawRect(doc, primitive);
            break;
          case 'line':
            this.drawLine(doc, primitive);
            break;
          case 'text':
            this.drawText(doc, primitive, fonts);
            break;
          case 'image':
            this.drawImage(doc, primitive, assets.images);
            break;
          case 'qr':
            this.drawQr(doc, primitive, assets.qrCodes);
            break;
          case 'placeholder':
            // Editor-only affordance; never printed.
            break;
          default:
            break;
        }
      });
    });

    doc.end();
    return finished;
  }

  /** Layout result without rendering — used by tests and parity checks. */
  layoutForInstance(formInstance, template, language = 'en', options = {}) {
    const plainTemplate = template && typeof template.toObject === 'function' ? template.toObject() : template;
    const organization = options.organization || null;
    const contract = resolveTemplateContract(
      { ...plainTemplate, pdfStyle: this.buildPdfStyle(plainTemplate || {}, organization) },
      { organization }
    );
    const instance = formInstance && typeof formInstance.toObject === 'function'
      ? formInstance.toObject()
      : (formInstance || {});

    return layoutDocument({
      contract,
      values: instance.values || {},
      formInstance: instance,
      language: language === 'ar' ? 'ar' : 'en',
      mode: 'print',
      resolveDepartment: (code) => this.getDepartmentLabel(organization, code, language)
    });
  }
}

const generator = new PDFGenerator();
generator.PDFGenerator = PDFGenerator;
generator.resolveAndLoadImage = resolveAndLoadImage;
generator.downloadImage = downloadImage;
generator.normalizeColor = normalizeColor;
generator.isFetchableUrl = isFetchableUrl;

module.exports = generator;
