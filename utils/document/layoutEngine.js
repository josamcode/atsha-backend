/**
 * Shared document contract — layout and paint engine.
 *
 * SHARED MODULE (see units.js for the mirroring rules).
 *
 * This is the single authority for what a template looks like on paper. It takes
 * a template plus form values and returns fully paginated pages of absolutely
 * positioned DRAW PRIMITIVES in PostScript points.
 *
 * Every consumer is a thin executor of those primitives:
 *   - the builder canvas (DOM, plus editor chrome keyed by `blockId`)
 *   - the preview / view / print screens (DOM)
 *   - the server PDF (PDFKit)
 *
 * Because nobody re-derives layout, "the builder disagrees with the PDF" is not
 * expressible: a divergence would have to be a bug in an executor drawing a
 * primitive wrongly, not two different layout algorithms.
 *
 * Primitive kinds (all coordinates page-absolute, origin top-left, unit = pt):
 *   rect        { x, y, w, h, fill?, stroke?, strokeWidth?, radius?, dash? }
 *   line        { x1, y1, x2, y2, stroke, width, dash? }
 *   text        { x, y, w, lines[], fontSize, bold, color, align, rtl, lineHeight }
 *   image       { x, y, w, h, src, fit, radius?, opacity?, rotation? }
 *   qr          { x, y, size, value, foreground, background }
 *   placeholder { x, y, w, h, label, labelAr }   (edit mode only)
 */

const { getPageGeometry, mmToPt, clampNumber } = require('./units');
const { layoutParagraph } = require('./textMetrics');
const { GRID_COLUMNS } = require('./documentModel');
const {
  resolveTemplateContract,
  localizedText,
  getLeafColumns,
  getColumnDepth,
  getTableCellKey,
  getFieldValueKey,
  getDynamicRowsKey,
  readValue
} = require('./templateContract');

/** CSS pixels used by legacy image/size settings → points at 96dpi. */
const PX_TO_PT = 0.75;

/**
 * Hard ceiling on pagination. A malformed template (or a table asking for tens
 * of thousands of rows) must not be able to make a browser tab or an export
 * worker spin: stop, and say so in `overflows` rather than pretending.
 */
const MAX_PAGES = 400;

/** Smallest column that can still show a character; narrower is reported. */
const MIN_COLUMN_WIDTH_PT = 12;

/**
 * Section-title colours that mean "use the readable default". Both are historic
 * schema defaults rather than deliberate author choices.
 */
const AUTO_TITLE_COLORS = new Set(['', '#000000', '#111827']);

const LABELS = {
  formId: { en: 'Form ID', ar: 'رقم النموذج' },
  date: { en: 'Date', ar: 'التاريخ' },
  shift: { en: 'Shift', ar: 'الوردية' },
  department: { en: 'Department', ar: 'القسم' },
  filledBy: { en: 'Filled by', ar: 'تم الملء بواسطة' },
  submittedOn: { en: 'Submitted on', ar: 'تاريخ الإرسال' },
  approvedBy: { en: 'Approved by', ar: 'اعتمد بواسطة' },
  approvalDate: { en: 'Approval date', ar: 'تاريخ الاعتماد' },
  preparedBy: { en: 'Prepared by', ar: 'أعده' },
  signature: { en: 'Signature', ar: 'التوقيع' },
  noData: { en: 'No data', ar: 'لا توجد بيانات' },
  noImage: { en: 'No image uploaded', ar: 'لا توجد صورة مرفوعة' },
  page: { en: 'Page', ar: 'صفحة' },
  of: { en: 'of', ar: 'من' },
  yes: { en: 'Yes', ar: 'نعم' },
  no: { en: 'No', ar: 'لا' },
  morning: { en: 'Morning', ar: 'صباحية' },
  evening: { en: 'Evening', ar: 'مسائية' },
  night: { en: 'Night', ar: 'ليلية' },
  emptySection: { en: 'Empty section', ar: 'قسم فارغ' },
  emptyBlock: { en: 'Empty block — select it to add content', ar: 'عنصر فارغ — اختره لإضافة محتوى' }
};

const label = (key, language) => (language === 'ar' ? LABELS[key].ar : LABELS[key].en);

const isBlank = (value) => value === undefined || value === null || value === '';

const resolveAlign = (align, rtl) => {
  if (align === 'center') return 'center';
  if (align === 'left' || align === 'right') return align;
  if (align === 'justify') return rtl ? 'right' : 'left';
  if (align === 'end') return rtl ? 'left' : 'right';
  return rtl ? 'right' : 'left';
};

const pad2 = (value) => String(value).padStart(2, '0');

/**
 * Locale-independent date formatting. `toLocaleDateString` depends on the host
 * ICU build, which differs between a browser and a slim Node image — that would
 * make the PDF and the preview disagree, so both use this instead.
 */
const formatDateValue = (value, language, withTime = false) => {
  if (isBlank(value)) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const ymd = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (!withTime) return ymd;
  return `${ymd} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const formatValue = (value, type, language) => {
  if (isBlank(value)) {
    return '';
  }
  switch (type) {
    case 'boolean':
      if (value === true || value === 'true') return label('yes', language);
      if (value === false || value === 'false') return label('no', language);
      return String(value);
    case 'date':
      return formatDateValue(value, language, false);
    case 'time':
      return String(value);
    case 'datetime':
      return formatDateValue(value, language, true);
    case 'number':
      return String(value);
    case 'image':
    case 'file':
      if (typeof value === 'object') {
        return value.filename || value.name || '';
      }
      return String(value);
    default:
      if (typeof value === 'object') {
        return value.text || value.value || '';
      }
      return String(value);
  }
};

const getImageSrc = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.url || value.path || value.secure_url || '';
};

const textPrimitive = (options) => ({
  k: 'text',
  x: options.x,
  y: options.y,
  w: options.w,
  lines: options.lines,
  fontSize: options.fontSize,
  bold: Boolean(options.bold),
  color: options.color,
  align: options.align,
  rtl: Boolean(options.rtl),
  lineHeight: options.lineHeight,
  blockId: options.blockId
});

/** Measure + emit a paragraph in one place so height and paint never drift. */
const paragraphBox = (text, width, options) => {
  const fontSize = options.fontSize;
  const spacing = options.lineSpacing || 1.3;
  const measured = layoutParagraph(text, width, { fontSize, bold: options.bold, lineSpacing: spacing });
  return {
    height: measured.height,
    lineHeight: measured.lineHeight,
    lines: measured.lines,
    paint: (x, y, blockId) => (measured.lines.length === 0 ? [] : [textPrimitive({
      x,
      y,
      w: width,
      lines: measured.lines,
      fontSize,
      bold: options.bold,
      color: options.color,
      align: options.align,
      rtl: options.rtl,
      lineHeight: measured.lineHeight,
      blockId
    })])
  };
};

/* ------------------------------------------------------------------------- */
/* Header block                                                               */
/* ------------------------------------------------------------------------- */

const buildHeaderBlock = (block, ctx, width) => {
  const { theme, language, rtl, template } = ctx;
  const header = template.pdfStyle?.header || {};
  const branding = theme.branding;
  const padding = 8;
  const fontSize = clampNumber(header.fontSize, 14, 6, 48);
  const logoSize = header.showLogo === false ? 0 : clampNumber(header.logoSize, 48, 0, 160) * PX_TO_PT;
  const gap = logoSize > 0 ? 10 : 0;
  const textWidth = Math.max(40, width - padding * 2 - logoSize - gap);
  const split = header.layout === 'split';

  const parts = [];
  if (header.showCompanyName !== false) {
    const name = localizedText(branding.companyName, language);
    if (name) {
      parts.push(paragraphBox(name, textWidth, {
        fontSize: fontSize + 3, bold: true, color: theme.primary, align: resolveAlign('start', rtl), rtl
      }));
    }
  }
  if (header.showTitle !== false) {
    const title = localizedText(template.title, language);
    if (title) {
      parts.push(paragraphBox(title, textWidth, {
        fontSize, bold: true, color: header.titleColor || header.textColor || theme.text, align: resolveAlign('start', rtl), rtl
      }));
    }
  }
  if (header.showSubtitle === true) {
    const subtitle = localizedText(header.subtitle, language);
    if (subtitle) {
      parts.push(paragraphBox(subtitle, textWidth, {
        fontSize: Math.max(7, fontSize - 3), bold: false, color: theme.muted, align: resolveAlign('start', rtl), rtl
      }));
    }
  }
  if (header.showCompanyAddress !== false) {
    const address = localizedText(branding.companyAddress, language);
    if (address) {
      parts.push(paragraphBox(address, textWidth, {
        fontSize: Math.max(7, fontSize - 4), bold: false, color: theme.muted, align: resolveAlign('start', rtl), rtl
      }));
    }
  }
  if (header.showDate !== false) {
    const dateText = `${label('date', language)}: ${formatDateValue(ctx.formInstance?.date || ctx.now, language)}`;
    parts.push(paragraphBox(dateText, textWidth, {
      fontSize: Math.max(7, fontSize - 4), bold: false, color: theme.muted, align: resolveAlign('start', rtl), rtl
    }));
  }

  const textHeight = parts.reduce((sum, part) => sum + part.height, 0) + Math.max(0, parts.length - 1) * 2;
  const minHeight = clampNumber(header.height, 60, 0, 400) * PX_TO_PT;
  const contentHeight = Math.max(textHeight, logoSize);
  const height = Math.max(minHeight, contentHeight + padding * 2);

  const border = header.border || {};
  const borderWidth = border.show === false ? 0 : clampNumber(border.width, 2, 0, 12) * PX_TO_PT;
  const borderColor = border.color || theme.primary;
  const borderPosition = border.position || 'bottom';

  const paint = (x, y, w) => {
    const primitives = [];
    const background = header.backgroundColor;
    if (background && background !== 'transparent') {
      primitives.push({ k: 'rect', x, y, w, h: height, fill: background, blockId: block.id });
    }

    // Logo sits on the side opposite the text column, mirrored for RTL.
    const logoOnStart = split;
    const logoX = (rtl ? !logoOnStart : logoOnStart)
      ? x + padding
      : x + w - padding - logoSize;
    const textX = (rtl ? !logoOnStart : logoOnStart)
      ? x + padding + logoSize + gap
      : x + padding;

    if (logoSize > 0 && branding.logoUrl) {
      primitives.push({
        k: 'image',
        x: logoX,
        y: y + (height - logoSize) / 2,
        w: logoSize,
        h: logoSize,
        src: branding.logoUrl,
        fit: 'contain',
        blockId: block.id
      });
    }

    let cursor = y + Math.max(padding, (height - textHeight) / 2);
    parts.forEach((part) => {
      primitives.push(...part.paint(textX, cursor, block.id));
      cursor += part.height + 2;
    });

    if (borderWidth > 0 && borderPosition !== 'none') {
      const dash = border.style === 'dashed' ? [4, 3] : (border.style === 'dotted' ? [1, 2] : null);
      const edges = borderPosition === 'all'
        ? ['top', 'bottom', 'left', 'right']
        : [borderPosition];
      edges.forEach((edge) => {
        const half = borderWidth / 2;
        if (edge === 'bottom') {
          primitives.push({ k: 'line', x1: x, y1: y + height - half, x2: x + w, y2: y + height - half, stroke: borderColor, width: borderWidth, dash, blockId: block.id });
        } else if (edge === 'top') {
          primitives.push({ k: 'line', x1: x, y1: y + half, x2: x + w, y2: y + half, stroke: borderColor, width: borderWidth, dash, blockId: block.id });
        } else if (edge === 'left') {
          primitives.push({ k: 'line', x1: x + half, y1: y, x2: x + half, y2: y + height, stroke: borderColor, width: borderWidth, dash, blockId: block.id });
        } else if (edge === 'right') {
          primitives.push({ k: 'line', x1: x + w - half, y1: y, x2: x + w - half, y2: y + height, stroke: borderColor, width: borderWidth, dash, blockId: block.id });
        }
      });
    }

    return primitives;
  };

  return { splittable: false, units: [{ h: height, paint: (x, y, w) => paint(x, y, w) }] };
};

/* ------------------------------------------------------------------------- */
/* Metadata block                                                             */
/* ------------------------------------------------------------------------- */

const buildMetadataBlock = (block, ctx, width) => {
  const { theme, language, rtl, template, formInstance, mode } = ctx;
  const config = template.pdfStyle?.metadata || {};
  const instance = formInstance || {};

  const departmentLabel = ctx.resolveDepartment
    ? ctx.resolveDepartment(instance.department)
    : (instance.department || '');

  const shiftKey = instance.shift;
  const shiftLabel = shiftKey && LABELS[shiftKey] ? label(shiftKey, language) : (shiftKey || '');

  const items = [];
  const push = (enabled, key, value) => {
    if (enabled === false) return;
    if (mode !== 'edit' && isBlank(value)) return;
    items.push({ label: label(key, language), value: isBlank(value) ? '—' : String(value) });
  };

  push(config.showFormId, 'formId', instance._id ? `#${String(instance._id).slice(-8)}` : '');
  push(config.showDate, 'date', formatDateValue(instance.date, language));
  push(config.showShift, 'shift', shiftLabel);
  push(config.showDepartment, 'department', departmentLabel);
  push(config.showFilledBy, 'filledBy', instance.filledBy?.name);
  push(config.showSubmittedOn, 'submittedOn', formatDateValue(instance.createdAt, language));
  if (instance.approvedBy) {
    push(config.showApprovedBy, 'approvedBy', instance.approvedBy?.name);
    push(config.showApprovalDate, 'approvalDate', formatDateValue(instance.approvalDate, language));
  }

  const columns = width > 380 ? 4 : 2;
  const gap = 6;
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const labelSize = 6.5;
  const valueSize = 9;

  const cells = items.map((item) => {
    const labelBox = paragraphBox(item.label, cellWidth - 10, {
      fontSize: labelSize, bold: false, color: theme.muted, align: resolveAlign('start', rtl), rtl
    });
    const valueBox = paragraphBox(item.value, cellWidth - 10, {
      fontSize: valueSize, bold: true, color: theme.text, align: resolveAlign('start', rtl), rtl
    });
    return { labelBox, valueBox, height: labelBox.height + valueBox.height + 10 };
  });

  const rows = [];
  for (let i = 0; i < cells.length; i += columns) {
    const rowCells = cells.slice(i, i + columns);
    rows.push({ cells: rowCells, height: Math.max(...rowCells.map((cell) => cell.height)) });
  }

  if (rows.length === 0) {
    if (mode !== 'edit') {
      return { splittable: false, units: [] };
    }
    return {
      splittable: false,
      units: [{
        h: 24,
        paint: (x, y, w) => [{ k: 'placeholder', x, y, w, h: 24, label: LABELS.emptyBlock.en, labelAr: LABELS.emptyBlock.ar, blockId: block.id }]
      }]
    };
  }

  const units = rows.map((row) => ({
    h: row.height + gap,
    paint: (x, y, w) => {
      const primitives = [];
      const effectiveCellWidth = (w - gap * (columns - 1)) / columns;
      row.cells.forEach((cell, index) => {
        const logicalX = rtl
          ? x + w - effectiveCellWidth - index * (effectiveCellWidth + gap)
          : x + index * (effectiveCellWidth + gap);
        primitives.push({
          k: 'rect', x: logicalX, y, w: effectiveCellWidth, h: row.height,
          fill: '#f8fafc', stroke: theme.border, strokeWidth: 0.5, radius: 3, blockId: block.id
        });
        primitives.push(...cell.labelBox.paint(logicalX + 5, y + 5, block.id));
        primitives.push(...cell.valueBox.paint(logicalX + 5, y + 5 + cell.labelBox.height, block.id));
      });
      return primitives;
    }
  }));

  return { splittable: true, units };
};

/* ------------------------------------------------------------------------- */
/* Table                                                                      */
/* ------------------------------------------------------------------------- */

const parseColumnWidth = (raw) => {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim() === 'auto') {
    return { kind: 'auto', value: 1 };
  }
  const value = raw.trim();
  const percent = /^([\d.]+)%$/.exec(value);
  if (percent) return { kind: 'percent', value: Number(percent[1]) || 0 };
  const fr = /^([\d.]+)fr$/i.exec(value);
  if (fr) return { kind: 'fr', value: Number(fr[1]) || 1 };
  const px = /^([\d.]+)px$/i.exec(value);
  if (px) return { kind: 'px', value: Number(px[1]) || 0 };
  return { kind: 'auto', value: 1 };
};

/** Resolve leaf column widths to points; always sums to exactly `totalWidth`. */
const resolveColumnWidths = (leafColumns, totalWidth) => {
  const specs = leafColumns.map((column) => parseColumnWidth(column?.width));
  const widths = new Array(specs.length).fill(0);
  let fixed = 0;

  specs.forEach((spec, index) => {
    if (spec.kind === 'percent') {
      widths[index] = (spec.value / 100) * totalWidth;
      fixed += widths[index];
    } else if (spec.kind === 'px') {
      widths[index] = spec.value * PX_TO_PT;
      fixed += widths[index];
    }
  });

  const flexible = specs
    .map((spec, index) => ({ spec, index }))
    .filter((entry) => entry.spec.kind === 'fr' || entry.spec.kind === 'auto');
  const remaining = Math.max(0, totalWidth - fixed);
  const totalWeight = flexible.reduce((sum, entry) => sum + (entry.spec.value || 1), 0);

  if (flexible.length > 0) {
    flexible.forEach((entry) => {
      widths[entry.index] = totalWeight > 0
        ? (remaining * (entry.spec.value || 1)) / totalWeight
        : remaining / flexible.length;
    });
  }

  const sum = widths.reduce((total, value) => total + value, 0);
  if (sum <= 0) {
    return widths.map(() => totalWidth / Math.max(1, widths.length));
  }
  // Normalise away rounding/over-allocation so borders always meet exactly.
  const scale = totalWidth / sum;
  const scaled = widths.map((value) => value * scale);

  // A column narrower than a single glyph would let its neighbour's text draw on
  // top of it with nothing to show for it. Lift the runts to a legible minimum
  // and take the difference from the widest columns; the caller reports it.
  const minimum = Math.min(MIN_COLUMN_WIDTH_PT, totalWidth / Math.max(1, scaled.length));
  const deficit = scaled.reduce((total, value) => total + Math.max(0, minimum - value), 0);
  if (deficit <= 0) {
    return scaled;
  }

  const donors = scaled
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value > minimum);
  const donorTotal = donors.reduce((total, entry) => total + (entry.value - minimum), 0);

  return scaled.map((value, index) => {
    if (value < minimum) {
      return minimum;
    }
    if (donorTotal <= 0) {
      return value;
    }
    return value - ((value - minimum) / donorTotal) * deficit;
  });
};

/** Flatten a (possibly grouped) header into positioned cells. */
const buildHeaderMatrix = (columns, depth, startLeaf = 0, level = 0) => {
  const cells = [];
  let leafCursor = startLeaf;
  (Array.isArray(columns) ? columns : []).forEach((column) => {
    const children = Array.isArray(column?.children) ? column.children : [];
    if (children.length > 0) {
      const nested = buildHeaderMatrix(children, depth, leafCursor, level + 1);
      const leafCount = nested.leafCount;
      cells.push({ column, level, rowSpan: 1, startLeaf: leafCursor, leafCount });
      cells.push(...nested.cells);
      leafCursor += leafCount;
    } else {
      cells.push({ column, level, rowSpan: depth - level, startLeaf: leafCursor, leafCount: 1 });
      leafCursor += 1;
    }
  });
  return { cells, leafCount: leafCursor - startLeaf };
};

const buildTableUnits = (block, section, ctx, width) => {
  const { theme, language, rtl, values } = ctx;
  const advanced = section.advancedLayout || {};
  const table = advanced.table || {};
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const leafColumns = getLeafColumns(columns);

  if (leafColumns.length === 0) {
    return {
      units: [{
        h: 22,
        paint: (x, y, w) => [{ k: 'placeholder', x, y, w, h: 22, label: 'Table has no columns', labelAr: 'الجدول بلا أعمدة', blockId: block.id }]
      }],
      overflow: null
    };
  }

  const depth = Math.max(1, getColumnDepth(columns));
  const widths = resolveColumnWidths(leafColumns, width);
  const offsets = [];
  let offsetCursor = 0;
  widths.forEach((columnWidth) => {
    offsets.push(offsetCursor);
    offsetCursor += columnWidth;
  });

  const headerFontSize = clampNumber(table.headerStyle?.fontSize, 9, 5, 32);
  const cellFontSize = clampNumber(table.cellStyle?.fontSize, 9, 5, 32);
  const headerBold = table.headerStyle?.bold !== false;
  const headerBg = table.headerStyle?.backgroundColor || '#f3f4f6';
  const headerColor = table.headerStyle?.textColor || theme.text;
  const cellBg = table.cellStyle?.backgroundColor || '';
  const cellColor = table.cellStyle?.textColor || theme.text;
  const showBorders = table.showBorders !== false;
  const borderColor = table.borderColor || theme.border;
  const borderWidth = showBorders ? clampNumber(table.borderWidth, 0.75, 0, 6) : 0;
  const cellPadding = 4;

  // Convert a logical (start-edge) offset into a page x. RTL mirrors columns.
  const columnX = (x, w, index) => (rtl
    ? x + w - offsets[index] - widths[index]
    : x + offsets[index]);

  const headerMatrix = buildHeaderMatrix(columns, depth).cells;
  const headerLevelHeights = new Array(depth).fill(0);
  headerMatrix.forEach((cell) => {
    const cellWidth = cell.leafCount === 1
      ? widths[cell.startLeaf]
      : widths.slice(cell.startLeaf, cell.startLeaf + cell.leafCount).reduce((sum, value) => sum + value, 0);
    const box = paragraphBox(localizedText(cell.column?.label, language), Math.max(8, cellWidth - cellPadding * 2), {
      fontSize: headerFontSize, bold: headerBold, color: headerColor, align: 'center', rtl
    });
    const perLevel = (box.height + cellPadding * 2) / cell.rowSpan;
    for (let level = cell.level; level < cell.level + cell.rowSpan; level += 1) {
      headerLevelHeights[level] = Math.max(headerLevelHeights[level], perLevel);
    }
  });
  for (let level = 0; level < depth; level += 1) {
    headerLevelHeights[level] = Math.max(headerLevelHeights[level], headerFontSize * 1.6 + cellPadding);
  }
  const headerHeight = headerLevelHeights.reduce((sum, value) => sum + value, 0);
  const levelOffsets = [];
  let levelCursor = 0;
  headerLevelHeights.forEach((value) => {
    levelOffsets.push(levelCursor);
    levelCursor += value;
  });

  const paintHeader = (x, y, w) => {
    const primitives = [];
    primitives.push({ k: 'rect', x, y, w, h: headerHeight, fill: headerBg, blockId: block.id });
    headerMatrix.forEach((cell) => {
      const cellWidth = widths.slice(cell.startLeaf, cell.startLeaf + cell.leafCount)
        .reduce((sum, value) => sum + value, 0);
      const cellX = rtl
        ? x + w - offsets[cell.startLeaf] - cellWidth
        : x + offsets[cell.startLeaf];
      const cellY = y + levelOffsets[cell.level];
      const cellHeight = headerLevelHeights
        .slice(cell.level, cell.level + cell.rowSpan)
        .reduce((sum, value) => sum + value, 0);
      const columnHeaderBg = cell.column?.headerStyle?.backgroundColor;
      if (columnHeaderBg) {
        primitives.push({ k: 'rect', x: cellX, y: cellY, w: cellWidth, h: cellHeight, fill: columnHeaderBg, blockId: block.id });
      }
      if (borderWidth > 0) {
        primitives.push({
          k: 'rect', x: cellX, y: cellY, w: cellWidth, h: cellHeight,
          stroke: borderColor, strokeWidth: borderWidth, blockId: block.id
        });
      }
      const box = paragraphBox(localizedText(cell.column?.label, language), Math.max(8, cellWidth - cellPadding * 2), {
        fontSize: headerFontSize,
        bold: headerBold,
        color: cell.column?.headerStyle?.textColor || headerColor,
        align: 'center',
        rtl
      });
      primitives.push(...box.paint(cellX + cellPadding, cellY + (cellHeight - box.height) / 2, block.id));
    });
    return primitives;
  };

  // ---- rows -------------------------------------------------------------
  const rowsData = [];
  if (table.dynamicRows && table.rowSource) {
    const raw = readValue(values, getDynamicRowsKey(section.id, table.rowSource));
    const list = Array.isArray(raw) ? raw : [];
    list.forEach((row) => {
      rowsData.push(leafColumns.map((column, index) => {
        const key = column?.fieldKey || column?.id || `col${index + 1}`;
        return formatValue(row?.[key], column?.fieldType, language);
      }));
    });
  } else {
    // Empty rows are printed on purpose — that is what `numberOfRows` is for on
    // a form that gets filled in by hand.
    const declared = Number(table.numberOfRows);
    const rowCount = Number.isFinite(declared) && declared > 0 ? Math.min(declared, 500) : 10;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      rowsData.push(leafColumns.map((column, columnIndex) => {
        const raw = readValue(values, getTableCellKey(section.id, rowIndex, column, columnIndex));
        return formatValue(raw, column?.fieldType, language);
      }));
    }
  }

  const emptyDynamic = table.dynamicRows && rowsData.length === 0;
  if (emptyDynamic) {
    rowsData.push(leafColumns.map((unused, index) => (index === 0 ? label('noData', language) : '')));
  }

  const rowUnits = rowsData.map((cells, rowIndex) => {
    const boxes = cells.map((cellText, columnIndex) => paragraphBox(
      cellText,
      Math.max(8, widths[columnIndex] - cellPadding * 2),
      {
        fontSize: cellFontSize,
        bold: false,
        color: cellColor,
        align: resolveAlign(leafColumns[columnIndex]?.alignment, rtl),
        rtl
      }
    ));
    const height = Math.max(cellFontSize * 1.7, ...boxes.map((box) => box.height)) + cellPadding * 2;
    const striped = table.stripedRows && rowIndex % 2 === 1;

    return {
      h: height,
      paint: (x, y, w) => {
        const primitives = [];
        if (striped) {
          primitives.push({ k: 'rect', x, y, w, h: height, fill: '#f9fafb', blockId: block.id });
        } else if (cellBg) {
          primitives.push({ k: 'rect', x, y, w, h: height, fill: cellBg, blockId: block.id });
        }
        boxes.forEach((box, columnIndex) => {
          const cellX = columnX(x, w, columnIndex);
          if (borderWidth > 0) {
            primitives.push({
              k: 'rect', x: cellX, y, w: widths[columnIndex], h: height,
              stroke: borderColor, strokeWidth: borderWidth, blockId: block.id
            });
          }
          primitives.push(...box.paint(cellX + cellPadding, y + cellPadding, block.id));
        });
        return primitives;
      }
    };
  });

  const units = [];
  if (table.showHeader !== false) {
    units.push({ h: headerHeight, sticky: true, paint: paintHeader });
  }
  units.push(...rowUnits);

  return { units, overflow: null };
};

/* ------------------------------------------------------------------------- */
/* Section block                                                              */
/* ------------------------------------------------------------------------- */

const buildFieldCell = (field, section, ctx, width) => {
  const { theme, language, rtl, values, mode } = ctx;
  const display = field.pdfDisplay || {};
  const fieldLayout = field.layout || {};
  const fontSize = clampNumber(display.fontSize, theme.fontSize.field, 5, 48);
  const align = resolveAlign(display.alignment || fieldLayout.alignment, rtl);
  const showLabel = display.showLabel !== false;
  const showValue = display.showValue !== false;

  const labelText = localizedText(field.label, language);
  const labelBox = showLabel && labelText
    ? paragraphBox(field.required ? `${labelText} *` : labelText, width, {
      fontSize: Math.max(6, fontSize * 0.85), bold: true, color: theme.muted, align, rtl
    })
    : null;

  if (field.type === 'image') {
    const imageWidth = Math.min(width, clampNumber(fieldLayout.imageWidth, 220, 40, 2000) * PX_TO_PT);
    const imageHeight = clampNumber(fieldLayout.imageHeight, 160, 40, 2000) * PX_TO_PT;
    const src = showValue ? getImageSrc(readValue(values, getFieldValueKey(section.id, field.key))) : '';
    const height = (labelBox ? labelBox.height + 3 : 0) + imageHeight;

    return {
      height,
      paint: (x, y, blockId) => {
        const primitives = [];
        let cursor = y;
        if (labelBox) {
          primitives.push(...labelBox.paint(x, cursor, blockId));
          cursor += labelBox.height + 3;
        }
        const imageX = align === 'center'
          ? x + (width - imageWidth) / 2
          : (align === 'right' ? x + width - imageWidth : x);
        if (src) {
          primitives.push({
            k: 'image',
            x: imageX,
            y: cursor,
            w: imageWidth,
            h: imageHeight,
            src,
            fit: fieldLayout.objectFit || 'cover',
            radius: clampNumber(fieldLayout.borderRadius, 0, 0, 100) * PX_TO_PT,
            borderWidth: clampNumber(fieldLayout.borderWidth, 0, 0, 40) * PX_TO_PT,
            borderColor: fieldLayout.borderColor || theme.border,
            backgroundColor: fieldLayout.backgroundColor || '',
            blockId
          });
        } else {
          primitives.push({
            k: 'rect', x: imageX, y: cursor, w: imageWidth, h: imageHeight,
            fill: fieldLayout.backgroundColor || '#f8fafc', stroke: theme.border, strokeWidth: 0.5,
            radius: clampNumber(fieldLayout.borderRadius, 0, 0, 100) * PX_TO_PT, blockId
          });
          const emptyBox = paragraphBox(label('noImage', language), imageWidth - 8, {
            fontSize: Math.max(6, fontSize * 0.8), bold: false, color: theme.muted, align: 'center', rtl
          });
          primitives.push(...emptyBox.paint(imageX + 4, cursor + (imageHeight - emptyBox.height) / 2, blockId));
        }
        return primitives;
      }
    };
  }

  let valueText = '';
  if (showValue) {
    if (field.type === 'static_text') {
      valueText = localizedText(field.defaultValue, language);
    } else {
      const raw = readValue(values, getFieldValueKey(section.id, field.key));
      valueText = formatValue(raw, field.type, language);
      if (isBlank(valueText)) {
        valueText = mode === 'edit' ? '' : '—';
      }
    }
  }

  const valueBox = showValue
    ? paragraphBox(valueText, width, {
      fontSize,
      bold: display.bold === true,
      color: theme.text,
      align,
      rtl,
      lineSpacing: clampNumber(fieldLayout.lineSpacing, theme.spacing.lineSpacing, 1, 3)
    })
    : null;

  const underlineNeeded = showValue && !valueText && field.type !== 'static_text';
  const gap = labelBox && valueBox ? 2 : 0;
  const minHeight = fontSize * 1.5;
  const height = Math.max(
    minHeight,
    (labelBox ? labelBox.height : 0) + gap + (valueBox ? Math.max(valueBox.height, fontSize * 1.4) : 0)
  );

  return {
    height,
    paint: (x, y, blockId) => {
      const primitives = [];
      let cursor = y;
      if (labelBox) {
        primitives.push(...labelBox.paint(x, cursor, blockId));
        cursor += labelBox.height + gap;
      }
      if (valueBox) {
        primitives.push(...valueBox.paint(x, cursor, blockId));
        if (underlineNeeded) {
          const lineY = cursor + Math.max(valueBox.height, fontSize * 1.4) - 1;
          primitives.push({
            k: 'line', x1: x, y1: lineY, x2: x + width, y2: lineY,
            stroke: theme.border, width: 0.5, dash: [2, 2], blockId
          });
        }
      }
      return primitives;
    }
  };
};

const buildSectionBlock = (block, ctx, width) => {
  const { theme, language, rtl, mode } = ctx;
  const section = ctx.contract.sectionsById.get(block.refId);

  if (!section) {
    return { splittable: false, units: [] };
  }

  const sectionStyle = section.pdfStyle || {};
  const advanced = section.advancedLayout || {};
  const styling = advanced.styling || {};
  const padding = clampNumber(sectionStyle.padding, 10, 0, 80) * PX_TO_PT;
  const showBorder = sectionStyle.showBorder !== false;
  const borderWidth = showBorder ? clampNumber(sectionStyle.borderWidth, 1, 0, 12) * PX_TO_PT : 0;
  const borderColor = styling.borderColor || sectionStyle.borderColor || theme.border;
  const background = sectionStyle.showBackground ? (sectionStyle.backgroundColor || '#ffffff') : '';
  const innerWidth = Math.max(20, width - padding * 2);

  const units = [];

  // Section title
  const showTitle = styling.showTitle !== false;
  const titleText = localizedText(section.label, language);
  if (showTitle && (titleText || mode === 'edit')) {
    const isHeaderSection = section.sectionType === 'header';
    const titleFontSize = clampNumber(styling.titleFontSize, theme.fontSize.section, 6, 48);
    const barColor = section.sectionType === 'totals' ? theme.primary : '#374151';
    // The title sits on a dark bar, so the readable default is white. The two
    // historic schema defaults are indistinguishable from "never set", so they
    // mean auto; any other value is an explicit author choice and is honoured.
    const rawTitleColor = typeof styling.titleColor === 'string' ? styling.titleColor.trim().toLowerCase() : '';
    const authorTitleColor = AUTO_TITLE_COLORS.has(rawTitleColor) ? '' : styling.titleColor;
    const titleColor = isHeaderSection
      ? (authorTitleColor || theme.primary)
      : (authorTitleColor || '#ffffff');
    const box = paragraphBox(titleText || (language === 'ar' ? 'قسم بدون عنوان' : 'Untitled section'), innerWidth - 12, {
      fontSize: titleFontSize,
      bold: true,
      color: isHeaderSection ? theme.primary : titleColor,
      align: isHeaderSection ? 'center' : resolveAlign('start', rtl),
      rtl
    });
    const titleHeight = box.height + (isHeaderSection ? 6 : 10);

    units.push({
      h: titleHeight,
      paint: (x, y, w) => {
        const primitives = [];
        if (!isHeaderSection) {
          primitives.push({ k: 'rect', x, y, w, h: titleHeight, fill: barColor, radius: 2, blockId: block.id });
        }
        primitives.push(...box.paint(x + 6, y + (isHeaderSection ? 3 : 5), block.id));
        return primitives;
      }
    });
    units.push({ h: 4, paint: () => [] });
  }

  if (section.sectionType === 'header') {
    return {
      splittable: true,
      decor: { background, borderColor, borderWidth, padding },
      units
    };
  }

  const isTable = advanced.layoutType === 'table'
    && Array.isArray(advanced.table?.columns)
    && advanced.table.columns.length > 0;

  if (isTable) {
    const table = buildTableUnits(block, section, ctx, innerWidth);
    units.push(...table.units);
  } else {
    const fields = (section.fields || [])
      .filter((field) => field.visible !== false)
      .slice()
      .sort((a, b) => {
        const rowA = a.grid?.row ?? a.order ?? 0;
        const rowB = b.grid?.row ?? b.order ?? 0;
        if (rowA !== rowB) return rowA - rowB;
        return (a.grid?.x ?? 0) - (b.grid?.x ?? 0);
      });

    if (fields.length === 0) {
      if (mode === 'edit') {
        units.push({
          h: 26,
          paint: (x, y, w) => [{
            k: 'placeholder', x, y, w, h: 26,
            label: LABELS.emptySection.en, labelAr: LABELS.emptySection.ar, blockId: block.id
          }]
        });
      }
    } else {
      const gutter = clampNumber(advanced.spacing?.fieldSpacing, theme.spacing.fieldSpacing, 0, 60) * PX_TO_PT;
      const rowGap = Math.max(4, gutter);
      const columnUnit = (innerWidth - gutter * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
      const spanWidth = (span) => Math.max(8, span * columnUnit + (span - 1) * gutter);

      const rowsMap = new Map();
      fields.forEach((field) => {
        const rowIndex = field.grid?.row ?? field.order ?? 0;
        if (!rowsMap.has(rowIndex)) rowsMap.set(rowIndex, []);
        rowsMap.get(rowIndex).push(field);
      });

      const orderedRows = [...rowsMap.entries()].sort((a, b) => a[0] - b[0]);
      orderedRows.forEach(([, rowFields], rowPosition) => {
        const cells = rowFields.map((field) => {
          const span = clampNumber(field.grid?.w, GRID_COLUMNS, 1, GRID_COLUMNS);
          return {
            field,
            span,
            x: clampNumber(field.grid?.x, 0, 0, GRID_COLUMNS - 1),
            cell: buildFieldCell(field, section, ctx, spanWidth(span))
          };
        });
        const height = Math.max(...cells.map((entry) => entry.cell.height));

        units.push({
          h: height + (rowPosition < orderedRows.length - 1 ? rowGap : 0),
          paint: (x, y, w) => {
            const primitives = [];
            const effectiveUnit = (w - gutter * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
            cells.forEach((entry) => {
              const cellWidth = Math.max(8, entry.span * effectiveUnit + (entry.span - 1) * gutter);
              const logicalOffset = entry.x * (effectiveUnit + gutter);
              const cellX = rtl ? x + w - logicalOffset - cellWidth : x + logicalOffset;
              primitives.push(...entry.cell.paint(cellX, y, block.id));
            });
            return primitives;
          }
        });
      });
    }
  }

  return {
    splittable: true,
    decor: { background, borderColor, borderWidth, padding, radius: showBorder ? 4 : 0 },
    units
  };
};

/* ------------------------------------------------------------------------- */
/* Signature block                                                            */
/* ------------------------------------------------------------------------- */

const buildSignatureBlock = (block, ctx, width) => {
  const { theme, language, rtl, template, formInstance } = ctx;
  const config = template.pdfStyle?.signature || {};

  const entries = [];
  if (config.showPreparedBy !== false) {
    entries.push({ label: label('preparedBy', language), value: formInstance?.filledBy?.name || '' });
  }
  if (config.showApprovedBy !== false) {
    entries.push({ label: label('approvedBy', language), value: formInstance?.approvedBy?.name || '' });
  }
  if (entries.length === 0) {
    return { splittable: false, units: [] };
  }

  const gap = 24;
  const columnWidth = (width - gap * (entries.length - 1)) / entries.length;
  const boxes = entries.map((entry) => ({
    labelBox: paragraphBox(entry.label, columnWidth, {
      fontSize: 8, bold: false, color: theme.muted, align: resolveAlign('start', rtl), rtl
    }),
    valueBox: paragraphBox(entry.value, columnWidth, {
      fontSize: 10, bold: true, color: theme.text, align: resolveAlign('start', rtl), rtl
    })
  }));

  const height = 26 + Math.max(...boxes.map((box) => box.labelBox.height + box.valueBox.height));

  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => {
        const primitives = [];
        const effectiveWidth = (w - gap * (entries.length - 1)) / entries.length;
        boxes.forEach((box, index) => {
          const logicalOffset = index * (effectiveWidth + gap);
          const columnX = rtl ? x + w - logicalOffset - effectiveWidth : x + logicalOffset;
          primitives.push(...box.labelBox.paint(columnX, y, block.id));
          const lineY = y + height - 14;
          primitives.push({
            k: 'line', x1: columnX, y1: lineY, x2: columnX + effectiveWidth, y2: lineY,
            stroke: theme.border, width: 1, blockId: block.id
          });
          primitives.push(...box.valueBox.paint(columnX, lineY + 2, block.id));
        });
        return primitives;
      }
    }]
  };
};

/* ------------------------------------------------------------------------- */
/* Footer block                                                               */
/* ------------------------------------------------------------------------- */

const buildFooterBlock = (block, ctx, width, pageContext = {}) => {
  const { theme, language, rtl, template } = ctx;
  const footer = template.pdfStyle?.footer || {};
  const branding = theme.branding;
  const fontSize = clampNumber(footer.fontSize, 8, 5, 24);
  const padding = 6;
  const templateKind = ['classic', 'centered', 'contact', 'minimal'].includes(footer.template)
    ? footer.template
    : 'classic';

  const showQr = footer.showQRCode === true && Boolean(footer.qrCodeValue);
  const qrSize = showQr ? clampNumber(footer.qrCodeSize, 60, 24, 160) * PX_TO_PT : 0;

  const infoLines = [];
  if (footer.showCompanyInfo !== false) {
    const name = localizedText(branding.companyName, language) || (typeof footer.companyName === 'string' ? footer.companyName : '');
    if (name) infoLines.push(name);
  }
  if (footer.showPhoneNumber === true) {
    const phone = footer.phoneNumber || branding.companyPhone;
    if (phone) infoLines.push(String(phone));
  }
  const content = localizedText(footer.content, language);
  if (content) infoLines.push(content);
  if (footer.showSocialIcons === true) {
    const links = (Array.isArray(footer.socialLinks) ? footer.socialLinks : [])
      .map((link) => link?.url)
      .filter(Boolean);
    if (links.length > 0) infoLines.push(links.join('  |  '));
  }

  const pageText = footer.showPageNumbers !== false && pageContext.pageCount
    ? `${label('page', language)} ${pageContext.pageNumber} ${label('of', language)} ${pageContext.pageCount}`
    : '';

  const centered = templateKind === 'centered';
  const minimal = templateKind === 'minimal';
  const align = centered ? 'center' : resolveAlign('start', rtl);
  const textWidth = Math.max(40, width - padding * 2 - (centered ? 0 : qrSize + (qrSize ? 10 : 0)));

  const infoBox = infoLines.length > 0
    ? paragraphBox(infoLines.join(minimal ? '  •  ' : '\n'), textWidth, {
      fontSize, bold: false, color: footer.textColor || theme.muted, align, rtl
    })
    : null;
  const pageBox = pageText
    ? paragraphBox(pageText, centered ? textWidth : Math.max(40, width - padding * 2), {
      fontSize, bold: false, color: footer.textColor || theme.muted, align: centered ? 'center' : resolveAlign('end', rtl), rtl
    })
    : null;

  const stackHeight = (infoBox ? infoBox.height : 0)
    + (pageBox ? pageBox.height + 2 : 0)
    + (centered && qrSize ? qrSize + 4 : 0);
  const minHeight = clampNumber(footer.height, 40, 0, 300) * PX_TO_PT;
  const height = Math.max(minHeight, Math.max(stackHeight, centered ? 0 : qrSize) + padding * 2);

  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => {
        const primitives = [];
        const background = footer.backgroundColor;
        if (background && background !== 'transparent') {
          primitives.push({ k: 'rect', x, y, w, h: height, fill: background, blockId: block.id });
        }

        if (centered) {
          let cursor = y + padding;
          if (qrSize) {
            primitives.push({
              k: 'qr', x: x + (w - qrSize) / 2, y: cursor, size: qrSize,
              value: footer.qrCodeValue, foreground: theme.primary, background: '#ffffff', blockId: block.id
            });
            cursor += qrSize + 4;
          }
          if (pageBox) {
            primitives.push(...pageBox.paint(x + padding, cursor, block.id));
            cursor += pageBox.height + 2;
          }
          if (infoBox) {
            primitives.push(...infoBox.paint(x + padding, cursor, block.id));
          }
          return primitives;
        }

        const position = footer.qrCodePosition === 'left' ? 'left' : (footer.qrCodePosition === 'center' ? 'center' : 'right');
        if (qrSize) {
          const qrX = position === 'left'
            ? x + padding
            : (position === 'center' ? x + (w - qrSize) / 2 : x + w - padding - qrSize);
          primitives.push({
            k: 'qr', x: qrX, y: y + (height - qrSize) / 2, size: qrSize,
            value: footer.qrCodeValue, foreground: theme.primary, background: '#ffffff', blockId: block.id
          });
        }

        const textX = (qrSize && position === 'left') ? x + padding + qrSize + 10 : x + padding;
        let cursor = y + padding;
        if (infoBox) {
          primitives.push(...infoBox.paint(textX, cursor, block.id));
          cursor += infoBox.height + 2;
        }
        if (pageBox) {
          primitives.push(...pageBox.paint(x + padding, Math.max(cursor, y + height - padding - pageBox.height), block.id));
        }
        return primitives;
      }
    }]
  };
};

/* ------------------------------------------------------------------------- */
/* Simple visual blocks                                                       */
/* ------------------------------------------------------------------------- */

const buildTextBlock = (block, ctx, width) => {
  const { theme, language, rtl, mode } = ctx;
  const props = block.props || {};
  const text = localizedText(props.content, language);
  const fontSize = clampNumber(props.fontSize, 11, 5, 72);

  if (!text) {
    if (mode !== 'edit') {
      return { splittable: false, units: [] };
    }
    return {
      splittable: false,
      units: [{
        h: Math.max(fontSize * 1.6, mmToPt(block.minHeightMm || 0)),
        paint: (x, y, w) => [{
          k: 'placeholder', x, y, w, h: Math.max(fontSize * 1.6, mmToPt(block.minHeightMm || 0)),
          label: 'Text block — add content', labelAr: 'عنصر نص — أضف المحتوى', blockId: block.id
        }]
      }]
    };
  }

  const box = paragraphBox(text, width, {
    fontSize,
    bold: props.bold === true,
    color: props.color || theme.text,
    align: resolveAlign(props.align, rtl),
    rtl,
    lineSpacing: clampNumber(props.lineSpacing, 1.35, 1, 3)
  });

  const height = Math.max(box.height, mmToPt(block.minHeightMm || 0));

  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => {
        const primitives = [];
        if (props.backgroundColor) {
          primitives.push({ k: 'rect', x, y, w, h: height, fill: props.backgroundColor, radius: 2, blockId: block.id });
        }
        primitives.push(...box.paint(x, y, block.id));
        return primitives;
      }
    }]
  };
};

const buildDividerBlock = (block, ctx, width) => {
  const { theme } = ctx;
  const props = block.props || {};
  const thickness = clampNumber(props.thickness, 1, 0.25, 12);
  const inset = mmToPt(clampNumber(props.insetMm, 0, 0, 80));
  const height = Math.max(thickness + 6, mmToPt(block.minHeightMm || 0));
  const dash = props.style === 'dashed' ? [4, 3] : (props.style === 'dotted' ? [1, 2] : null);

  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => [{
        k: 'line',
        x1: x + inset,
        y1: y + height / 2,
        x2: x + w - inset,
        y2: y + height / 2,
        stroke: props.color || theme.border,
        width: thickness,
        dash,
        blockId: block.id
      }]
    }]
  };
};

const buildSpacerBlock = (block, ctx) => {
  const height = mmToPt(clampNumber(block.heightMm, 8, 1, 400));
  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => (ctx.mode === 'edit'
        ? [{ k: 'placeholder', x, y, w, h: height, label: 'Spacer', labelAr: 'مسافة', blockId: block.id, subtle: true }]
        : [])
    }]
  };
};

const buildImageBlock = (block, ctx, width) => {
  const { theme, mode } = ctx;
  const props = block.props || {};
  const height = mmToPt(clampNumber(block.heightMm, 40, 3, 500));

  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => {
        if (!props.url) {
          return mode === 'edit'
            ? [{ k: 'placeholder', x, y, w, h: height, label: 'Image — choose a source', labelAr: 'صورة — اختر المصدر', blockId: block.id }]
            : [];
        }
        return [{
          k: 'image',
          x, y, w, h: height,
          src: props.url,
          fit: props.fit || 'contain',
          radius: clampNumber(props.borderRadius, 0, 0, 100) * PX_TO_PT,
          borderWidth: clampNumber(props.borderWidth, 0, 0, 40) * PX_TO_PT,
          borderColor: props.borderColor || theme.border,
          backgroundColor: props.backgroundColor || '',
          opacity: clampNumber(props.opacity, 100, 0, 100) / 100,
          blockId: block.id
        }];
      }
    }]
  };
};

const buildQrBlock = (block, ctx, width) => {
  const { theme, language, rtl, mode } = ctx;
  const props = block.props || {};
  const boxHeight = mmToPt(clampNumber(block.heightMm, 30, 5, 300));
  const caption = localizedText(props.caption, language);
  const captionBox = caption
    ? paragraphBox(caption, width, { fontSize: 7, bold: false, color: theme.muted, align: 'center', rtl })
    : null;
  const qrSize = Math.max(8, Math.min(width, boxHeight - (captionBox ? captionBox.height + 3 : 0)));
  const height = boxHeight;

  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => {
        if (!props.value) {
          return mode === 'edit'
            ? [{ k: 'placeholder', x, y, w, h: height, label: 'QR code — set a value', labelAr: 'رمز QR — حدد القيمة', blockId: block.id }]
            : [];
        }
        const primitives = [{
          k: 'qr',
          x: x + (w - qrSize) / 2,
          y,
          size: qrSize,
          value: props.value,
          foreground: props.foreground || theme.primary,
          background: props.background || '#ffffff',
          blockId: block.id
        }];
        if (captionBox) {
          primitives.push(...captionBox.paint(x, y + qrSize + 3, block.id));
        }
        return primitives;
      }
    }]
  };
};

const buildStampBlock = (block, ctx, width) => {
  const { theme, language, rtl, mode } = ctx;
  const props = block.props || {};
  const height = mmToPt(clampNumber(block.heightMm, 30, 5, 300));
  const text = localizedText(props.label, language);

  return {
    splittable: false,
    units: [{
      h: height,
      paint: (x, y, w) => {
        if (props.url) {
          return [{
            k: 'image', x, y, w, h: height, src: props.url, fit: 'contain',
            opacity: clampNumber(props.opacity, 100, 0, 100) / 100,
            rotation: clampNumber(props.rotation, 0, -180, 180),
            blockId: block.id
          }];
        }
        if (!text) {
          return mode === 'edit'
            ? [{ k: 'placeholder', x, y, w, h: height, label: 'Stamp — add an image or label', labelAr: 'ختم — أضف صورة أو نصاً', blockId: block.id }]
            : [];
        }
        const size = Math.min(w, height);
        const box = paragraphBox(text, size - 12, {
          fontSize: 10, bold: true, color: props.borderColor || theme.primary, align: 'center', rtl
        });
        return [
          {
            k: 'rect', x: x + (w - size) / 2, y, w: size, h: size,
            stroke: props.borderColor || theme.primary, strokeWidth: 2, radius: size / 2,
            rotation: clampNumber(props.rotation, 0, -180, 180), blockId: block.id
          },
          ...box.paint(x + (w - size) / 2 + 6, y + (size - box.height) / 2, block.id)
        ];
      }
    }]
  };
};

const buildPageBreakBlock = (block, ctx) => ({
  splittable: false,
  isPageBreak: true,
  units: [{
    h: ctx.mode === 'edit' ? 14 : 0,
    paint: (x, y, w) => (ctx.mode === 'edit'
      ? [{ k: 'placeholder', x, y, w, h: 14, label: 'Page break', labelAr: 'فاصل صفحات', blockId: block.id, subtle: true }]
      : [])
  }]
});

/* ------------------------------------------------------------------------- */
/* Block dispatch                                                             */
/* ------------------------------------------------------------------------- */

const buildBlock = (block, ctx, width, pageContext) => {
  switch (block.type) {
    case 'header': return buildHeaderBlock(block, ctx, width);
    case 'metadata': return buildMetadataBlock(block, ctx, width);
    case 'section': return buildSectionBlock(block, ctx, width);
    case 'signature': return buildSignatureBlock(block, ctx, width);
    case 'footer': return buildFooterBlock(block, ctx, width, pageContext);
    case 'text': return buildTextBlock(block, ctx, width);
    case 'divider': return buildDividerBlock(block, ctx, width);
    case 'spacer': return buildSpacerBlock(block, ctx, width);
    case 'image': return buildImageBlock(block, ctx, width);
    case 'qr': return buildQrBlock(block, ctx, width);
    case 'stamp': return buildStampBlock(block, ctx, width);
    case 'watermark': return { splittable: false, units: [] };
    case 'pageBreak': return buildPageBreakBlock(block, ctx);
    default: return { splittable: false, units: [] };
  }
};

const paintDecor = (built, block, x, y, w, h) => {
  const decor = built.decor;
  if (!decor) return [];
  const primitives = [];
  if (decor.background) {
    primitives.push({ k: 'rect', x, y, w, h, fill: decor.background, radius: decor.radius || 0, blockId: block.id });
  }
  if (decor.borderWidth > 0) {
    primitives.push({
      k: 'rect', x, y, w, h,
      stroke: decor.borderColor, strokeWidth: decor.borderWidth, radius: decor.radius || 0, blockId: block.id
    });
  }
  return primitives;
};

/* ------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Lay out a whole document.
 *
 * @param {object} input
 * @param {object} input.template        stored template (any layout version)
 * @param {object} [input.values]        form values keyed exactly as submissions are
 * @param {object} [input.formInstance]  metadata envelope (id, dates, people)
 * @param {'en'|'ar'} [input.language]
 * @param {'edit'|'preview'|'print'} [input.mode]
 * @param {object} [input.organization]  branding fallbacks
 * @param {function} [input.resolveDepartment]
 */
const layoutDocument = (input = {}) => {
  const contract = input.contract || resolveTemplateContract(input.template, { organization: input.organization });
  if (!contract.ok) {
    return { ok: false, error: contract.error, pages: [], blockBoxes: [], overflows: [] };
  }

  const documentValue = contract.document;
  const geometry = getPageGeometry(documentValue.page);
  const language = input.language === 'ar' ? 'ar' : 'en';
  const mode = ['edit', 'preview', 'print'].includes(input.mode) ? input.mode : 'preview';

  const ctx = {
    contract,
    template: contract.template,
    theme: contract.theme,
    values: input.values || {},
    formInstance: input.formInstance || null,
    language,
    rtl: language === 'ar',
    mode,
    geometry,
    now: input.now || null,
    resolveDepartment: input.resolveDepartment
  };

  const blocks = documentValue.blocks;
  const headerBlocks = blocks.filter((block) => block.placement === 'pageHeader' && !block.hidden);
  const footerBlocks = blocks.filter((block) => block.placement === 'pageFooter' && !block.hidden);
  const overlayBlocks = blocks.filter((block) => block.placement === 'overlay' && !block.hidden);
  const flowBlocks = blocks
    .filter((block) => block.placement === 'flow' && !block.hidden)
    .sort((a, b) => (a.row - b.row) || (a.x - b.x));

  const contentWidth = geometry.contentWidthPt;
  const gutter = mmToPt(documentValue.grid.gutterMm);
  const rowGap = mmToPt(documentValue.grid.rowGapMm);
  const columnUnit = (contentWidth - gutter * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const spanWidth = (span) => Math.max(8, span * columnUnit + (span - 1) * gutter);
  const spanOffset = (x) => x * (columnUnit + gutter);

  const overflows = [];

  const includeOnPage = (block, pageIndex) => {
    if (block.repeat === 'first') return pageIndex === 0;
    if (block.repeat === 'notFirst') return pageIndex > 0;
    return true;
  };

  const builtHeaders = headerBlocks.map((block) => ({ block, built: buildBlock(block, ctx, contentWidth) }));

  /**
   * Page furniture only ever has two shapes — "first page" and "any later page"
   * — because `repeat` is the only page-dependent input. Measuring once per
   * shape instead of once per page keeps a 300-page export linear.
   *
   * The footer's page-number text is not known until the total is, but its
   * geometry must be reserved before packing. The probe uses a four-digit
   * counter so the reserved height can never be short of the real one.
   */
  const furnitureCache = new Map();
  const furnitureFor = (pageIndex) => {
    const shape = pageIndex === 0 ? 'first' : 'rest';
    if (furnitureCache.has(shape)) {
      return furnitureCache.get(shape);
    }
    const headerHeight = builtHeaders
      .filter((entry) => includeOnPage(entry.block, pageIndex))
      .reduce((sum, entry) => sum + entry.built.units.reduce((h, unit) => h + unit.h, 0), 0);
    const footerHeight = footerBlocks
      .filter((block) => includeOnPage(block, pageIndex))
      .reduce((sum, block) => {
        const built = buildBlock(block, ctx, contentWidth, { pageNumber: 9999, pageCount: 9999 });
        return sum + built.units.reduce((h, unit) => h + unit.h, 0);
      }, 0);

    const value = { headerHeight, footerHeight };
    furnitureCache.set(shape, value);
    return value;
  };

  const bandFor = (pageIndex) => {
    const { headerHeight, footerHeight } = furnitureFor(pageIndex);
    return {
      top: geometry.contentYPt + headerHeight,
      bottom: geometry.contentYPt + geometry.contentHeightPt - footerHeight,
      headerHeight,
      footerHeight
    };
  };

  const pages = [];
  const blockBoxes = [];

  let pageIndex = 0;
  let band = bandFor(0);
  let cursorY = band.top;
  pages.push({ index: 0, primitives: [] });

  let pageLimitReached = false;

  const startNewPage = () => {
    if (pages.length >= MAX_PAGES) {
      if (!pageLimitReached) {
        pageLimitReached = true;
        overflows.push({
          blockId: null,
          kind: 'page-limit-reached',
          message: `This document exceeds the ${MAX_PAGES}-page limit and was truncated. Reduce the number of table rows or the amount of content.`,
          messageAr: `يتجاوز هذا المستند حد ${MAX_PAGES} صفحة وتم اقتطاعه. قلّل عدد صفوف الجدول أو حجم المحتوى.`
        });
      }
      // Keep filling the last page rather than growing without bound.
      cursorY = band.top;
      return;
    }
    pageIndex += 1;
    pages.push({ index: pageIndex, primitives: [] });
    band = bandFor(pageIndex);
    cursorY = band.top;
  };

  /** The page currently being filled. Read through a helper so the emit closures
   * inside the pagination loop never capture a stale page index. */
  const currentPage = () => pages[pageIndex];

  const rowsMap = new Map();
  flowBlocks.forEach((block) => {
    if (!rowsMap.has(block.row)) rowsMap.set(block.row, []);
    rowsMap.get(block.row).push(block);
  });
  const orderedRows = [...rowsMap.entries()].sort((a, b) => a[0] - b[0]);

  // A page break is only honoured once something actually follows it, otherwise
  // a break at the end of a document would print a blank sheet.
  let pendingBreak = false;

  orderedRows.forEach(([, rowBlocks]) => {
    const isPageBreakRow = rowBlocks.length === 1 && rowBlocks[0].type === 'pageBreak';
    if (isPageBreakRow) {
      if (mode === 'edit') {
        const built = buildBlock(rowBlocks[0], ctx, contentWidth);
        const unit = built.units[0];
        const x = geometry.contentXPt;
        currentPage().primitives.push(...unit.paint(x, cursorY, contentWidth));
        blockBoxes.push({
          blockId: rowBlocks[0].id, type: 'pageBreak', placement: 'flow',
          row: rowBlocks[0].row, pageIndex,
          x, y: cursorY, w: contentWidth, h: unit.h, fragment: 0
        });
        cursorY += unit.h + rowGap;
      }
      pendingBreak = true;
      return;
    }

    if (pendingBreak) {
      pendingBreak = false;
      if (cursorY > band.top) {
        startNewPage();
      }
    }

    if (rowBlocks.some((block) => block.breakBefore) && cursorY > band.top) {
      startNewPage();
    }

    const entries = rowBlocks.map((block) => {
      const width = spanWidth(block.w);
      const built = buildBlock(block, ctx, width);
      return {
        block,
        built,
        width,
        unitsHeight: built.units.reduce((sum, unit) => sum + unit.h, 0)
      };
    });

    const blockX = (block, width) => geometry.contentXPt
      + (ctx.rtl ? contentWidth - spanOffset(block.x) - width : spanOffset(block.x));

    const singleSplittable = entries.length === 1
      && entries[0].built.splittable
      && !entries[0].block.keepTogether
      && entries[0].built.units.length > 0;

    if (singleSplittable) {
      const entry = entries[0];
      const { block, built } = entry;
      const decorPad = built.decor?.padding || 0;
      const innerWidth = entry.width - decorPad * 2;
      const stickyUnits = built.units.filter((unit) => unit.sticky);
      const stickyHeight = stickyUnits.reduce((sum, unit) => sum + unit.h, 0);

      let index = 0;
      let fragment = 0;

      while (index < built.units.length) {
        // Continuation fragments repeat the sticky rows (a table's header) so a
        // table that breaks across pages stays readable.
        const prefix = fragment === 0 ? [] : stickyUnits;
        const prefixHeight = fragment === 0 ? 0 : stickyHeight;

        let available = band.bottom - cursorY - decorPad * 2;
        if (cursorY > band.top && available < prefixHeight + built.units[index].h) {
          startNewPage();
          available = band.bottom - cursorY - decorPad * 2;
        }

        const chosen = [...prefix];
        let used = prefixHeight;
        let placedAny = false;

        while (index < built.units.length) {
          const unit = built.units[index];
          if (used + unit.h > available) {
            if (!placedAny) {
              // Taller than a whole page even on a fresh sheet: place it and say so
              // rather than dropping content silently.
              chosen.push(unit);
              used += unit.h;
              index += 1;
              placedAny = true;
              overflows.push({
                blockId: block.id,
                refId: block.refId,
                kind: 'block-taller-than-page',
                message: 'Part of this block is taller than one page and may be clipped when printed.',
                messageAr: 'جزء من هذا العنصر أطول من صفحة واحدة وقد يتم قصه عند الطباعة.'
              });
            }
            break;
          }
          chosen.push(unit);
          used += unit.h;
          index += 1;
          placedAny = true;
        }

        const fragmentHeight = used + decorPad * 2;
        const x = blockX(block, entry.width);

        currentPage().primitives.push(...paintDecor(built, block, x, cursorY, entry.width, fragmentHeight));
        let unitY = cursorY + decorPad;
        chosen.forEach((unit) => {
          currentPage().primitives.push(...unit.paint(x + decorPad, unitY, innerWidth));
          unitY += unit.h;
        });

        blockBoxes.push({
          blockId: block.id,
          type: block.type,
          refId: block.refId,
          row: block.row,
          gridX: block.x,
          gridW: block.w,
          placement: 'flow',
          pageIndex,
          x,
          y: cursorY,
          w: entry.width,
          h: fragmentHeight,
          fragment
        });

        cursorY += fragmentHeight;
        fragment += 1;

        if (index < built.units.length) {
          startNewPage();
        }
      }
      cursorY += rowGap;
      return;
    }

    // Atomic row (side-by-side blocks, or a block explicitly kept together).
    const rowHeight = entries.reduce(
      (max, entry) => Math.max(max, entry.unitsHeight + (entry.built.decor?.padding || 0) * 2),
      0
    );
    if (rowHeight <= 0) {
      return;
    }
    const bandHeight = band.bottom - band.top;
    if (cursorY + rowHeight > band.bottom && cursorY > band.top) {
      startNewPage();
    }
    if (rowHeight > bandHeight) {
      entries.forEach((entry) => {
        overflows.push({
          blockId: entry.block.id,
          refId: entry.block.refId,
          kind: 'block-taller-than-page',
          message: 'This block is taller than one page and cannot be split across pages.',
          messageAr: 'هذا العنصر أطول من صفحة واحدة ولا يمكن تقسيمه بين الصفحات.'
        });
      });
    }

    entries.forEach((entry) => {
      const { block, built } = entry;
      const decorPad = built.decor?.padding || 0;
      const x = blockX(block, entry.width);
      const height = entry.unitsHeight + decorPad * 2;

      currentPage().primitives.push(...paintDecor(built, block, x, cursorY, entry.width, height));
      let unitY = cursorY + decorPad;
      built.units.forEach((unit) => {
        currentPage().primitives.push(...unit.paint(x + decorPad, unitY, entry.width - decorPad * 2));
        unitY += unit.h;
      });

      blockBoxes.push({
        blockId: block.id,
        type: block.type,
        refId: block.refId,
        row: block.row,
        gridX: block.x,
        gridW: block.w,
        placement: 'flow',
        pageIndex,
        x,
        y: cursorY,
        w: entry.width,
        h: height,
        fragment: 0
      });
    });

    cursorY += rowHeight + rowGap;
  });

  // ---- page furniture ---------------------------------------------------
  const pageCount = pages.length;
  pages.forEach((page) => {
    const furniture = [];

    let headerY = geometry.contentYPt;
    builtHeaders.forEach((entry) => {
      if (!includeOnPage(entry.block, page.index)) return;
      entry.built.units.forEach((unit) => {
        furniture.push(...unit.paint(geometry.contentXPt, headerY, contentWidth));
        blockBoxes.push({
          blockId: entry.block.id, type: entry.block.type, placement: 'pageHeader',
          pageIndex: page.index,
          x: geometry.contentXPt, y: headerY, w: contentWidth, h: unit.h, fragment: 0
        });
        headerY += unit.h;
      });
    });

    const activeFooters = footerBlocks.filter((block) => includeOnPage(block, page.index));
    const footerHeights = activeFooters.map((block) => {
      const built = buildBlock(block, ctx, contentWidth, { pageNumber: page.index + 1, pageCount });
      return { block, built, height: built.units.reduce((sum, unit) => sum + unit.h, 0) };
    });
    const totalFooterHeight = footerHeights.reduce((sum, entry) => sum + entry.height, 0);
    let footerY = geometry.contentYPt + geometry.contentHeightPt - totalFooterHeight;
    footerHeights.forEach((entry) => {
      entry.built.units.forEach((unit) => {
        furniture.push(...unit.paint(geometry.contentXPt, footerY, contentWidth));
        blockBoxes.push({
          blockId: entry.block.id, type: entry.block.type, placement: 'pageFooter',
          pageIndex: page.index,
          x: geometry.contentXPt, y: footerY, w: contentWidth, h: unit.h, fragment: 0
        });
        footerY += unit.h;
      });
    });

    // Overlays paint underneath the content for watermarks and on top otherwise.
    const under = [];
    const over = [];
    overlayBlocks.forEach((block) => {
      if (block.overlay?.pageScope === 'first' && page.index > 0) return;
      const primitives = paintOverlayBlock(block, ctx, geometry);
      if (primitives.length === 0) return;
      const target = block.type === 'watermark' ? under : over;
      target.push(...primitives);

      const overlay = block.overlay || {};
      const box = block.type === 'watermark'
        ? watermarkBox(block, geometry)
        : {
          x: mmToPt(overlay.xMm), y: mmToPt(overlay.yMm),
          w: mmToPt(overlay.wMm), h: mmToPt(overlay.hMm)
        };
      blockBoxes.push({
        blockId: block.id, type: block.type, pageIndex: page.index,
        x: box.x, y: box.y, w: box.w, h: box.h, fragment: 0, overlay: true
      });

      if (box.x < 0 || box.y < 0
        || box.x + box.w > geometry.widthPt
        || box.y + box.h > geometry.heightPt) {
        if (!overflows.some((item) => item.blockId === block.id && item.kind === 'overlay-out-of-bounds')) {
          overflows.push({
            blockId: block.id,
            kind: 'overlay-out-of-bounds',
            message: 'This floating element extends past the page edge.',
            messageAr: 'هذا العنصر العائم يتجاوز حدود الصفحة.'
          });
        }
      }
    });

    page.primitives = [...under, ...page.primitives, ...furniture, ...over];
    page.widthPt = geometry.widthPt;
    page.heightPt = geometry.heightPt;
    page.geometry = geometry;
  });

  return {
    ok: true,
    geometry,
    language,
    mode,
    pages,
    pageCount,
    blockBoxes,
    overflows,
    contract
  };
};

const watermarkBox = (block, geometry) => {
  const props = block.props || {};
  const sizePercent = clampNumber(props.sizePercent, 55, 1, 100);
  const width = geometry.contentWidthPt * (sizePercent / 100);
  const height = Math.min(geometry.contentHeightPt * 0.9, width);
  return {
    x: (geometry.widthPt - width) / 2,
    y: (geometry.heightPt - height) / 2,
    w: width,
    h: height
  };
};

const paintOverlayBlock = (block, ctx, geometry) => {
  const props = block.props || {};
  const overlay = block.overlay || {};

  if (block.type === 'watermark') {
    const url = props.url || ctx.theme.branding.watermarkUrl || ctx.theme.branding.logoUrl;
    if (!url) return [];
    const box = watermarkBox(block, geometry);
    return [{
      k: 'image',
      x: box.x, y: box.y, w: box.w, h: box.h,
      src: url,
      fit: 'contain',
      opacity: clampNumber(props.opacity, 5, 0, 100) / 100,
      rotation: clampNumber(props.rotation, 10, -180, 180),
      blockId: block.id
    }];
  }

  const x = mmToPt(overlay.xMm);
  const y = mmToPt(overlay.yMm);
  const w = mmToPt(overlay.wMm);
  const h = mmToPt(overlay.hMm);
  const opacity = clampNumber(overlay.opacity, 100, 0, 100) / 100;

  if (block.type === 'image' || block.type === 'stamp') {
    if (props.url) {
      return [{
        k: 'image', x, y, w, h, src: props.url, fit: props.fit || 'contain',
        opacity, rotation: clampNumber(overlay.rotation, 0, -180, 180), blockId: block.id
      }];
    }
    if (block.type === 'stamp') {
      const text = localizedText(props.label, ctx.language);
      if (!text) return [];
      const size = Math.min(w, h);
      const box = paragraphBox(text, size - 10, {
        fontSize: 10, bold: true, color: props.borderColor || ctx.theme.primary, align: 'center', rtl: ctx.rtl
      });
      return [
        {
          k: 'rect', x, y, w: size, h: size, stroke: props.borderColor || ctx.theme.primary,
          strokeWidth: 2, radius: size / 2, rotation: clampNumber(overlay.rotation, 0, -180, 180), blockId: block.id
        },
        ...box.paint(x + 5, y + (size - box.height) / 2, block.id)
      ];
    }
    return [];
  }

  if (block.type === 'qr') {
    if (!props.value) return [];
    return [{
      k: 'qr', x, y, size: Math.min(w, h), value: props.value,
      foreground: props.foreground || ctx.theme.primary, background: props.background || '#ffffff',
      blockId: block.id
    }];
  }

  if (block.type === 'text') {
    const text = localizedText(props.content, ctx.language);
    if (!text) return [];
    const box = paragraphBox(text, w, {
      fontSize: clampNumber(props.fontSize, 11, 5, 72),
      bold: props.bold === true,
      color: props.color || ctx.theme.text,
      align: resolveAlign(props.align, ctx.rtl),
      rtl: ctx.rtl
    });
    return box.paint(x, y, block.id);
  }

  return [];
};

module.exports = {
  PX_TO_PT,
  LABELS,
  layoutDocument,
  formatValue,
  formatDateValue,
  resolveAlign,
  resolveColumnWidths,
  parseColumnWidth,
  buildHeaderMatrix,
  getImageSrc
};
