/**
 * Shared document contract — realistic preview data.
 *
 * SHARED MODULE (see units.js for the mirroring rules).
 *
 * Sample values use exactly the same storage keys as real submissions
 * (`sectionId.fieldKey`, `sectionId.row_N.col_ID`, `sectionId.rowSource`) so the
 * preview exercises the real lookup path instead of a parallel fake one.
 */

const { getLeafColumns, getTableCellKey, getFieldValueKey, getDynamicRowsKey } = require('./templateContract');

const SAMPLE_ROW_COUNT = 3;

const sampleImageDataUrl = (language) => {
  const title = language === 'ar' ? 'معاينة صورة' : 'Image Preview';
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">',
    '<rect width="640" height="420" rx="24" fill="#f1f5f9"/>',
    '<rect x="24" y="24" width="592" height="372" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="3"/>',
    '<circle cx="190" cy="168" r="46" fill="#01c853" opacity="0.35"/>',
    '<path d="M104 302l104-92 72 58 88-96 168 130H104z" fill="#01c853" opacity="0.7"/>',
    `<text x="320" y="372" text-anchor="middle" font-size="26" font-family="Arial, sans-serif" fill="#475569">${title}</text>`,
    '</svg>'
  ].join('');
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const sampleForType = (type, language, seed = 0) => {
  const isArabic = language === 'ar';
  switch (type) {
    case 'number':
      return String(125 + seed * 7);
    case 'boolean':
      return seed % 2 === 0;
    case 'date':
      return '2026-03-10';
    case 'time':
      return '08:30';
    case 'datetime':
      return '2026-03-10T08:30:00.000Z';
    case 'textarea':
      return isArabic
        ? 'نص تجريبي يوضح كيف يمتد المحتوى الطويل على أكثر من سطر داخل المستند المطبوع.'
        : 'Sample paragraph content showing how longer text wraps across more than one line in the printed document.';
    case 'image':
      return sampleImageDataUrl(language);
    case 'file':
      return isArabic ? 'مرفق.pdf' : 'attachment.pdf';
    case 'static_text':
      return undefined;
    default:
      return isArabic ? `بيانات تجريبية ${seed + 1}` : `Sample value ${seed + 1}`;
  }
};

const sampleForField = (field, language) => {
  if (field?.type === 'select') {
    const option = Array.isArray(field.options) ? field.options[0] : null;
    if (option) {
      return (language === 'ar' ? option.ar : option.en) || option.en || option.ar || '';
    }
  }
  return sampleForType(field?.type, language, 0);
};

const sampleForColumn = (column, language, rowIndex) => {
  if (column?.fieldType === 'select') {
    return (language === 'ar' ? column.label?.ar : column.label?.en) || '';
  }
  return sampleForType(column?.fieldType, language, rowIndex);
};

/** Sample `values` map for a resolved template contract. */
const buildSampleValues = (contract, language = 'en') => {
  const values = {};
  if (!contract?.ok) {
    return values;
  }

  contract.sections.forEach((section) => {
    const advanced = section.advancedLayout || {};
    const tableConfig = advanced.table || {};
    const isTable = advanced.layoutType === 'table'
      && Array.isArray(tableConfig.columns)
      && tableConfig.columns.length > 0;

    if (isTable) {
      const leafColumns = getLeafColumns(tableConfig.columns);
      if (tableConfig.dynamicRows && tableConfig.rowSource) {
        values[getDynamicRowsKey(section.id, tableConfig.rowSource)] = Array.from(
          { length: SAMPLE_ROW_COUNT },
          (unused, rowIndex) => leafColumns.reduce((row, column, columnIndex) => {
            const key = column?.fieldKey || column?.id || `col${columnIndex + 1}`;
            row[key] = sampleForColumn(column, language, rowIndex);
            return row;
          }, {})
        );
      } else {
        const rowCount = Math.min(
          Number(tableConfig.numberOfRows) > 0 ? Number(tableConfig.numberOfRows) : SAMPLE_ROW_COUNT,
          SAMPLE_ROW_COUNT
        );
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          leafColumns.forEach((column, columnIndex) => {
            values[getTableCellKey(section.id, rowIndex, column, columnIndex)] =
              sampleForColumn(column, language, rowIndex);
          });
        }
      }
      return;
    }

    (section.fields || []).forEach((field) => {
      const value = sampleForField(field, language);
      if (value !== undefined) {
        values[getFieldValueKey(section.id, field.key)] = value;
      }
    });
  });

  return values;
};

/** Sample form instance envelope (metadata block, signatures, footer QR…). */
const buildSampleInstance = (template, language = 'en', options = {}) => {
  const isArabic = language === 'ar';
  const now = options.now || '2026-03-10T08:30:00.000Z';
  return {
    _id: options.id || 'preview0000000000000001',
    date: now,
    shift: 'morning',
    department: (Array.isArray(template?.departments) ? template.departments[0] : null) || 'all',
    status: template?.requiresApproval ? 'approved' : 'submitted',
    filledBy: { name: isArabic ? 'أحمد محمود' : 'Alex Morgan' },
    approvedBy: template?.requiresApproval
      ? { name: isArabic ? 'سارة عبد الله' : 'Sarah Abdullah' }
      : null,
    approvalDate: template?.requiresApproval ? now : null,
    approvalNotes: '',
    createdAt: now,
    values: {},
    images: []
  };
};

module.exports = {
  SAMPLE_ROW_COUNT,
  sampleForType,
  sampleForField,
  sampleForColumn,
  sampleImageDataUrl,
  buildSampleValues,
  buildSampleInstance
};
