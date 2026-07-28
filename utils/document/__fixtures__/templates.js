/**
 * Representative template fixtures shared by the frontend and backend suites.
 *
 * SHARED MODULE (see units.js for the mirroring rules).
 *
 * These are deliberately written in the LEGACY (layout v1) shape — exactly what
 * the database holds today — so every test exercises the real migration path
 * rather than a convenient already-migrated object.
 */

const LONG_EN = 'This paragraph exists to force real line wrapping inside the printed document. It repeats enough words that a single column cannot hold it on one line, which is the only way to prove that pagination, overflow reporting and renderer parity behave the same in the builder, the preview and the exported PDF.';
const LONG_AR = 'تهدف هذه الفقرة إلى إجبار المحرك على لف النص داخل المستند المطبوع، وهي طويلة بما يكفي لكي لا يتسع لها سطر واحد داخل عمود واحد، وهو ما يثبت أن ترقيم الصفحات والإبلاغ عن التجاوز وتطابق العرض تعمل بنفس الطريقة في المصمم والمعاينة وملف الـ PDF المصدَّر.';

const label = (en, ar) => ({ en, ar });

const field = (key, en, ar, overrides = {}) => ({
  key,
  label: label(en, ar),
  type: 'text',
  defaultValue: { en: '', ar: '' },
  placeholder: { en: '', ar: '' },
  options: [],
  required: false,
  order: 0,
  width: 'full',
  visible: true,
  pdfDisplay: { showLabel: true, showValue: true, fontSize: 10, bold: false, alignment: 'left' },
  layout: {
    width: 'auto', height: 'auto',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    alignment: 'left', lineSpacing: 1.2, fontSize: 10,
    imageWidth: 220, imageHeight: 160, objectFit: 'cover',
    borderRadius: 16, borderWidth: 0, borderColor: '#d1d5db',
    backgroundColor: '#f8fafc', shadow: false
  },
  ...overrides
});

const column = (id, en, ar, overrides = {}) => ({
  id,
  label: label(en, ar),
  fieldKey: '',
  fieldType: 'text',
  width: 'auto',
  alignment: 'left',
  children: [],
  headerStyle: { backgroundColor: '#f3f4f6', textColor: '#111827', fontSize: 12, bold: true },
  ...overrides
});

const sectionBase = (id, en, ar, overrides = {}) => ({
  id,
  label: label(en, ar),
  fields: [],
  order: 0,
  visible: true,
  sectionType: 'normal',
  pdfStyle: {
    backgroundColor: '#ffffff', borderColor: '#d1d5db', borderWidth: 1,
    padding: 12, marginTop: 0, marginBottom: 16, showBorder: true, showBackground: false
  },
  advancedLayout: {
    layoutType: 'simple',
    table: {
      enabled: false, columns: [], dynamicRows: false, rowSource: '',
      numberOfRows: 6, showHeader: true, showBorders: true,
      borderStyle: 'solid', borderColor: '#d1d5db', borderWidth: 1, stripedRows: false,
      headerStyle: { backgroundColor: '#f3f4f6', textColor: '#111827', fontSize: 12, bold: true },
      cellStyle: { backgroundColor: '#ffffff', textColor: '#111827', fontSize: 11 }
    },
    columns: { enabled: false, columnCount: 2, columnGap: 20, columnWidths: [], equalWidths: true },
    grid: { enabled: false, rows: 1, columns: 2, gap: 12, template: '' },
    spacing: { sectionSpacing: 20, fieldSpacing: 12, lineSpacing: 1.4 },
    sizing: { width: '100%', maxWidth: '100%', minWidth: 'auto', height: 'auto', maxHeight: 'auto', minHeight: 'auto' },
    padding: { top: 12, right: 12, bottom: 12, left: 12 },
    margins: { top: 0, right: 0, bottom: 16, left: 0 },
    styling: {
      titleColor: '#111827', titleFontSize: 16, showTitle: true,
      backgroundColor: '#ffffff', textColor: '#111827', borderColor: '#d1d5db'
    }
  },
  ...overrides
});

const templateBase = (id, titleEn, titleAr, sections) => ({
  // Deliberately no `_id`: these fixtures are hydrated straight into the Mongoose
  // model by the backend suite, and a synthetic string id would fail the ObjectId
  // cast before the assertions under test ever run.
  fixtureId: id,
  title: label(titleEn, titleAr),
  description: label('Fixture template', 'نموذج اختباري'),
  sections,
  visibleToRoles: ['admin', 'supervisor', 'employee'],
  editableByRoles: ['admin', 'supervisor', 'employee'],
  departments: ['all'],
  requiresApproval: true,
  isActive: true,
  layout: {
    sectionOrder: sections.map((section) => section.id),
    pageSize: 'A4',
    orientation: 'portrait',
    margins: { top: 40, right: 32, bottom: 40, left: 32 }
  },
  pdfStyle: {
    header: {
      enabled: true, showLogo: true, showTitle: true, showSubtitle: false, showDate: true,
      showCompanyName: true, showCompanyAddress: true, layout: 'default',
      logoPosition: 'right', titleStyle: 'normal', subtitle: { en: '', ar: '' },
      decorativeLineColor: '#01c853', height: 96, logoSize: 64,
      backgroundColor: '#ecfdf5', textColor: '#059669', titleColor: '#01c853',
      fontSize: 16, dashedBorder: false,
      border: { show: true, width: 3, style: 'solid', color: '#01c853', position: 'bottom' }
    },
    footer: {
      enabled: true, showPageNumbers: true, showCompanyInfo: true, showQRCode: false,
      showPhoneNumber: false, showSocialIcons: false, qrCodePosition: 'center', qrCodeSize: 84,
      template: 'classic', phoneNumber: '', qrCodeValue: '', socialLinks: [],
      companyName: 'AraRM', height: 56, backgroundColor: '#059669', textColor: '#ffffff',
      fontSize: 9, content: { en: '', ar: '' }
    },
    branding: {
      primaryColor: '#01c853', secondaryColor: '#059669',
      logoUrl: '', watermarkUrl: '', watermarkSize: 55, watermarkOpacity: 5,
      companyAddress: { en: '', ar: '' }, companyPhone: '', companyEmail: '',
      companyName: { en: 'AraRM', ar: 'أرارم' }
    },
    metadata: {
      enabled: true, showFormId: true, showDate: true, showShift: true, showDepartment: true,
      showFilledBy: true, showSubmittedOn: true, showApprovedBy: true, showApprovalDate: true
    },
    signature: { enabled: true, showPreparedBy: true, showApprovedBy: true },
    fontFamily: 'Helvetica',
    fontSize: { title: 20, section: 14, field: 10 },
    colors: { primary: '#01c853', secondary: '#059669', text: '#111827', border: '#d1d5db', background: '#ffffff' },
    spacing: { sectionSpacing: 16, fieldSpacing: 10, lineSpacing: 1.35 }
  }
});

/** 1. Simple form — one section, three fields. */
const simpleForm = () => templateBase('fixture_simple', 'Simple Form', 'نموذج بسيط', [
  sectionBase('section_basic', 'Basic Details', 'البيانات الأساسية', {
    order: 0,
    fields: [
      field('employee_name', 'Employee Name', 'اسم الموظف', { order: 0, width: 'half', required: true }),
      field('visit_date', 'Date', 'التاريخ', { order: 1, width: 'half', type: 'date' }),
      field('notes', 'Notes', 'ملاحظات', { order: 2, width: 'full', type: 'textarea' })
    ]
  })
]);

/** 2. Multi-section form. */
const multiSectionForm = () => templateBase('fixture_multi', 'Multi Section Form', 'نموذج متعدد الأقسام', [
  sectionBase('section_a', 'Section A', 'القسم أ', {
    order: 0,
    fields: [
      field('a1', 'Field A1', 'حقل أ١', { order: 0, width: 'half' }),
      field('a2', 'Field A2', 'حقل أ٢', { order: 1, width: 'half', type: 'number' })
    ]
  }),
  sectionBase('section_b', 'Section B', 'القسم ب', {
    order: 1,
    fields: [
      field('b1', 'Field B1', 'حقل ب١', { order: 0, width: 'third' }),
      field('b2', 'Field B2', 'حقل ب٢', { order: 1, width: 'third', type: 'boolean' }),
      field('b3', 'Field B3', 'حقل ب٣', { order: 2, width: 'third', type: 'select', options: [label('One', 'واحد'), label('Two', 'اثنان')] })
    ]
  }),
  sectionBase('section_hidden', 'Hidden Section', 'قسم مخفي', {
    order: 2,
    visible: false,
    fields: [field('h1', 'Hidden Field', 'حقل مخفي', { order: 0 })]
  })
]);

/** 3. Column / grid based form. */
const columnsForm = () => templateBase('fixture_columns', 'Columns Form', 'نموذج أعمدة', [
  sectionBase('section_columns', 'Three Columns', 'ثلاثة أعمدة', {
    order: 0,
    advancedLayout: {
      ...sectionBase('x', 'x', 'x').advancedLayout,
      layoutType: 'columns',
      columns: { enabled: true, columnCount: 3, columnGap: 16, columnWidths: ['2fr', '1fr', '1fr'], equalWidths: false }
    },
    fields: [
      field('c1', 'Wide Column', 'عمود عريض', { order: 0 }),
      field('c2', 'Narrow One', 'ضيق ١', { order: 1 }),
      field('c3', 'Narrow Two', 'ضيق ٢', { order: 2 }),
      field('c4', 'Second Row', 'الصف الثاني', { order: 3 })
    ]
  }),
  sectionBase('section_grid', 'Grid', 'شبكة', {
    order: 1,
    advancedLayout: {
      ...sectionBase('x', 'x', 'x').advancedLayout,
      layoutType: 'grid',
      grid: { enabled: true, rows: 2, columns: 4, gap: 10, template: '' }
    },
    fields: [
      field('g1', 'G1', 'ش١', { order: 0 }),
      field('g2', 'G2', 'ش٢', { order: 1 }),
      field('g3', 'G3', 'ش٣', { order: 2 }),
      field('g4', 'G4', 'ش٤', { order: 3 }),
      field('g5', 'G5', 'ش٥', { order: 4 })
    ]
  })
]);

/** 4. Table form (static rows). */
const tableForm = () => templateBase('fixture_table', 'Table Form', 'نموذج جدول', [
  sectionBase('section_items', 'Items', 'الأصناف', {
    order: 0,
    advancedLayout: {
      ...sectionBase('x', 'x', 'x').advancedLayout,
      layoutType: 'table',
      table: {
        ...sectionBase('x', 'x', 'x').advancedLayout.table,
        enabled: true,
        numberOfRows: 8,
        stripedRows: true,
        columns: [
          column('col_item', 'Item', 'الصنف', { width: '2fr' }),
          column('col_qty', 'Qty', 'الكمية', { width: '1fr', fieldType: 'number', alignment: 'center' }),
          column('col_notes', 'Notes', 'ملاحظات', { width: '2fr' })
        ]
      }
    }
  })
]);

/** 5. Grouped-table form. */
const groupedTableForm = () => templateBase('fixture_grouped', 'Grouped Table Form', 'نموذج جدول مجمّع', [
  sectionBase('section_grouped', 'Shift Totals', 'إجماليات الورديات', {
    order: 0,
    advancedLayout: {
      ...sectionBase('x', 'x', 'x').advancedLayout,
      layoutType: 'table',
      table: {
        ...sectionBase('x', 'x', 'x').advancedLayout.table,
        enabled: true,
        numberOfRows: 5,
        columns: [
          column('col_product', 'Product', 'المنتج', { width: '2fr' }),
          column('col_morning', 'Morning', 'صباحاً', {
            children: [
              column('col_morning_in', 'In', 'وارد', { fieldType: 'number', alignment: 'center' }),
              column('col_morning_out', 'Out', 'صادر', { fieldType: 'number', alignment: 'center' })
            ]
          }),
          column('col_evening', 'Evening', 'مساءً', {
            children: [
              column('col_evening_in', 'In', 'وارد', { fieldType: 'number', alignment: 'center' }),
              column('col_evening_out', 'Out', 'صادر', { fieldType: 'number', alignment: 'center' })
            ]
          })
        ]
      }
    }
  })
]);

/** 6/7. Long Arabic and long English documents (multi-page). */
const longForm = (language) => {
  const isArabic = language === 'ar';
  const sections = Array.from({ length: 8 }, (unused, index) => sectionBase(
    `section_long_${index}`,
    `Chapter ${index + 1}`,
    `الفصل ${index + 1}`,
    {
      order: index,
      fields: [
        field(`long_${index}_a`, `Summary ${index + 1}`, `الملخص ${index + 1}`, {
          order: 0, width: 'full', type: 'textarea'
        }),
        field(`long_${index}_b`, `Detail ${index + 1}`, `التفاصيل ${index + 1}`, {
          order: 1, width: 'full', type: 'static_text',
          defaultValue: { en: LONG_EN, ar: LONG_AR }
        })
      ]
    }
  ));
  return templateBase(
    isArabic ? 'fixture_long_ar' : 'fixture_long_en',
    'Long Document',
    'مستند طويل',
    sections
  );
};

/** 8. Image-heavy document. */
const imageHeavyForm = () => templateBase('fixture_images', 'Image Report', 'تقرير مصور', [
  sectionBase('section_images', 'Evidence', 'الأدلة', {
    order: 0,
    fields: Array.from({ length: 6 }, (unused, index) => field(
      `photo_${index}`,
      `Photo ${index + 1}`,
      `صورة ${index + 1}`,
      { order: index, width: 'half', type: 'image' }
    ))
  })
]);

/** 9. Multi-page document with a long dynamic table. */
const multiPageForm = () => templateBase('fixture_multipage', 'Multi Page Log', 'سجل متعدد الصفحات', [
  sectionBase('section_intro', 'Introduction', 'مقدمة', {
    order: 0,
    fields: [field('intro', 'Overview', 'نظرة عامة', { order: 0, type: 'static_text', defaultValue: { en: LONG_EN, ar: LONG_AR } })]
  }),
  sectionBase('section_log', 'Daily Log', 'السجل اليومي', {
    order: 1,
    advancedLayout: {
      ...sectionBase('x', 'x', 'x').advancedLayout,
      layoutType: 'table',
      table: {
        ...sectionBase('x', 'x', 'x').advancedLayout.table,
        enabled: true,
        numberOfRows: 60,
        showHeader: true,
        columns: [
          column('col_time', 'Time', 'الوقت', { width: '1fr', fieldType: 'time' }),
          column('col_event', 'Event', 'الحدث', { width: '3fr' }),
          column('col_by', 'By', 'بواسطة', { width: '1fr' })
        ]
      }
    }
  })
]);

/** 10. Large template used for performance checks (100+ components). */
const largeForm = (sectionCount = 40, fieldsPerSection = 4) => templateBase(
  'fixture_large',
  'Large Template',
  'نموذج كبير',
  Array.from({ length: sectionCount }, (unused, sectionIndex) => sectionBase(
    `section_big_${sectionIndex}`,
    `Section ${sectionIndex + 1}`,
    `القسم ${sectionIndex + 1}`,
    {
      order: sectionIndex,
      fields: Array.from({ length: fieldsPerSection }, (unusedField, fieldIndex) => field(
        `big_${sectionIndex}_${fieldIndex}`,
        `Field ${fieldIndex + 1}`,
        `حقل ${fieldIndex + 1}`,
        { order: fieldIndex, width: 'half' }
      ))
    }
  ))
);

const longEnglishForm = () => longForm('en');
const longArabicForm = () => longForm('ar');

const allFixtures = () => ({
  simpleForm: simpleForm(),
  multiSectionForm: multiSectionForm(),
  columnsForm: columnsForm(),
  tableForm: tableForm(),
  groupedTableForm: groupedTableForm(),
  longEnglishForm: longForm('en'),
  longArabicForm: longForm('ar'),
  imageHeavyForm: imageHeavyForm(),
  multiPageForm: multiPageForm(),
  largeForm: largeForm()
});

module.exports = {
  LONG_EN,
  LONG_AR,
  field,
  column,
  sectionBase,
  templateBase,
  simpleForm,
  multiSectionForm,
  columnsForm,
  tableForm,
  groupedTableForm,
  longForm,
  longEnglishForm,
  longArabicForm,
  imageHeavyForm,
  multiPageForm,
  largeForm,
  allFixtures
};
