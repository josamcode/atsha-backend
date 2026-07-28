/**
 * FormTemplate persistence contract.
 *
 * Mongoose strict mode silently deletes any property not declared in the schema,
 * which is how the builder used to lose `numberOfRows`, table styling, header
 * subtitles and the secondary colour on every save. These tests hydrate a
 * document in memory (no database needed) and assert that every property the
 * Template Builder produces survives the schema.
 *
 * Run with: node --test __tests__
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const FormTemplate = require('../models/FormTemplate');
const fixtures = require('../utils/document/__fixtures__/templates');
const { resolveTemplateContract } = require('../utils/document/templateContract');
const { DOCUMENT_VERSION } = require('../utils/document/documentModel');

const OWNER = new mongoose.Types.ObjectId();

/** Round-trip a plain object through the schema and back to a plain object. */
const roundTrip = (payload) => {
  const doc = new FormTemplate({ ...payload, createdBy: OWNER });
  return doc.toObject({ depopulate: true, flattenMaps: true });
};

/** Every leaf path of an object, as `a.b.0.c` strings. */
const leafPaths = (value, prefix = '', acc = []) => {
  if (value === null || value === undefined) {
    acc.push(prefix);
    return acc;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) acc.push(prefix);
    value.forEach((item, index) => leafPaths(item, `${prefix}.${index}`, acc));
    return acc;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) acc.push(prefix);
    keys.forEach((key) => leafPaths(value[key], prefix ? `${prefix}.${key}` : key, acc));
    return acc;
  }
  acc.push(prefix);
  return acc;
};

const readPath = (root, path) => path.split('.').reduce(
  (current, key) => (current === undefined || current === null ? undefined : current[key]),
  root
);

test('legacy template survives a schema round trip with no dropped property', () => {
  const template = fixtures.tableForm();
  const stored = roundTrip(template);

  const ignored = new Set(['_id', '__v', 'createdBy', 'createdAt', 'updatedAt', 'id', 'fixtureId']);
  const missing = [];

  leafPaths(template).forEach((path) => {
    const head = path.split('.')[0];
    if (ignored.has(head)) return;
    const expected = readPath(template, path);
    const actual = readPath(stored, path);
    if (expected === '' && (actual === '' || actual === undefined)) return;
    if (actual === undefined && expected !== undefined) {
      missing.push({ path, expected });
    }
  });

  assert.deepEqual(missing, [], `Schema dropped ${missing.length} propert(ies): ${missing.map((m) => m.path).join(', ')}`);
});

test('previously dropped properties now persist', () => {
  const template = fixtures.tableForm();
  template.sections[0].advancedLayout.table.numberOfRows = 17;
  template.sections[0].advancedLayout.table.headerStyle.backgroundColor = '#123456';
  template.sections[0].advancedLayout.table.cellStyle.textColor = '#654321';
  template.sections[0].advancedLayout.table.borderStyle = 'dashed';
  template.pdfStyle.header.showSubtitle = true;
  template.pdfStyle.header.subtitle = { en: 'Sub', ar: 'فرعي' };
  template.pdfStyle.header.titleColor = '#abcdef';
  template.pdfStyle.header.decorativeLineColor = '#fedcba';
  template.pdfStyle.header.dashedBorder = true;
  template.pdfStyle.header.titleStyle = 'compact';
  template.pdfStyle.colors.secondary = '#0f0f0f';
  template.pdfStyle.footer.companyName = 'AraRM Ltd';

  const stored = roundTrip(template);

  assert.equal(stored.sections[0].advancedLayout.table.numberOfRows, 17);
  assert.equal(stored.sections[0].advancedLayout.table.headerStyle.backgroundColor, '#123456');
  assert.equal(stored.sections[0].advancedLayout.table.cellStyle.textColor, '#654321');
  assert.equal(stored.sections[0].advancedLayout.table.borderStyle, 'dashed');
  assert.equal(stored.pdfStyle.header.showSubtitle, true);
  assert.equal(stored.pdfStyle.header.subtitle.ar, 'فرعي');
  assert.equal(stored.pdfStyle.header.titleColor, '#abcdef');
  assert.equal(stored.pdfStyle.header.decorativeLineColor, '#fedcba');
  assert.equal(stored.pdfStyle.header.dashedBorder, true);
  assert.equal(stored.pdfStyle.header.titleStyle, 'compact');
  assert.equal(stored.pdfStyle.colors.secondary, '#0f0f0f');
  assert.equal(stored.pdfStyle.footer.companyName, 'AraRM Ltd');
});

test('three levels of grouped table columns persist', () => {
  const template = fixtures.groupedTableForm();
  template.sections[0].advancedLayout.table.columns[1].children[0].children = [
    { id: 'deep_a', label: { en: 'Deep A', ar: 'عميق أ' }, fieldType: 'number', width: 'auto', alignment: 'center', children: [] }
  ];

  const stored = roundTrip(template);
  const deep = stored.sections[0].advancedLayout.table.columns[1].children[0].children;
  assert.equal(deep.length, 1);
  assert.equal(deep[0].id, 'deep_a');
});

test('table columns accept the image field type the builder offers', () => {
  const template = fixtures.tableForm();
  template.sections[0].advancedLayout.table.columns[0].fieldType = 'image';
  const doc = new FormTemplate({ ...template, createdBy: OWNER });
  const error = doc.validateSync();
  assert.equal(error, undefined, error && error.message);
});

test('approval section type is accepted', () => {
  const template = fixtures.simpleForm();
  template.sections[0].sectionType = 'approval';
  const doc = new FormTemplate({ ...template, createdBy: OWNER });
  const error = doc.validateSync();
  assert.equal(error, undefined, error && error.message);
});

test('a layout v2 document round-trips every block property', () => {
  const contract = resolveTemplateContract(fixtures.groupedTableForm());
  assert.equal(contract.ok, true);

  const payload = {
    ...contract.template,
    layoutVersion: DOCUMENT_VERSION,
    document: contract.document
  };
  const stored = roundTrip(payload);

  assert.equal(stored.layoutVersion, DOCUMENT_VERSION);
  assert.equal(stored.document.version, DOCUMENT_VERSION);
  assert.equal(stored.document.page.size, 'A4');
  assert.ok(Math.abs(stored.document.page.margins.top - contract.document.page.margins.top) < 1e-6);
  assert.equal(stored.document.blocks.length, contract.document.blocks.length);

  contract.document.blocks.forEach((block, index) => {
    const persisted = stored.document.blocks[index];
    assert.equal(persisted.id, block.id, `block ${index} id`);
    assert.equal(persisted.type, block.type, `block ${index} type`);
    assert.equal(persisted.placement, block.placement, `block ${index} placement`);
    assert.equal(persisted.x, block.x, `block ${index} x`);
    assert.equal(persisted.w, block.w, `block ${index} w`);
    assert.equal(persisted.row, block.row, `block ${index} row`);
    assert.equal(persisted.refId, block.refId, `block ${index} refId`);
    assert.equal(persisted.hidden, block.hidden, `block ${index} hidden`);
    assert.equal(persisted.locked, block.locked, `block ${index} locked`);
    assert.equal(persisted.keepTogether, block.keepTogether, `block ${index} keepTogether`);
    assert.equal(persisted.breakBefore, block.breakBefore, `block ${index} breakBefore`);
    assert.equal(persisted.repeat, block.repeat, `block ${index} repeat`);
    if (block.overlay) {
      assert.equal(persisted.overlay.xMm, block.overlay.xMm);
      assert.equal(persisted.overlay.pageScope, block.overlay.pageScope);
    }
  });
});

test('every block type validates', () => {
  const contract = resolveTemplateContract(fixtures.simpleForm());
  const blocks = contract.document.blocks.slice();
  const extra = [
    { id: 'b_text', type: 'text', placement: 'flow', x: 0, w: 12, row: 50, props: { content: { en: 'Hi', ar: 'مرحبا' }, fontSize: 12, bold: true, align: 'center', color: '#111111' } },
    { id: 'b_div', type: 'divider', placement: 'flow', x: 12, w: 12, row: 50, props: { thickness: 2, style: 'dashed', color: '#ff0000', insetMm: 4 } },
    { id: 'b_spacer', type: 'spacer', placement: 'flow', x: 0, w: 24, row: 51, heightMm: 12 },
    { id: 'b_img', type: 'image', placement: 'flow', x: 0, w: 8, row: 52, heightMm: 40, props: { url: 'https://example.com/a.png', fit: 'cover', borderRadius: 4, borderWidth: 1, borderColor: '#000000', opacity: 80 } },
    { id: 'b_qr', type: 'qr', placement: 'flow', x: 8, w: 6, row: 52, heightMm: 30, props: { value: 'https://example.com', foreground: '#000000', background: '#ffffff', caption: { en: 'Scan', ar: 'امسح' } } },
    { id: 'b_stamp', type: 'stamp', placement: 'overlay', x: 0, w: 6, row: 0, heightMm: 30, overlay: { pageScope: 'first', xMm: 120, yMm: 200, wMm: 40, hMm: 40, rotation: -12, opacity: 90 }, props: { label: { en: 'APPROVED', ar: 'معتمد' }, borderColor: '#01c853', rotation: -12 } },
    { id: 'b_break', type: 'pageBreak', placement: 'flow', x: 0, w: 24, row: 53 }
  ];

  const doc = new FormTemplate({
    ...contract.template,
    createdBy: OWNER,
    layoutVersion: DOCUMENT_VERSION,
    document: { ...contract.document, blocks: [...blocks, ...extra] }
  });
  const error = doc.validateSync();
  assert.equal(error, undefined, error && error.message);

  const stored = doc.toObject();
  const byId = new Map(stored.document.blocks.map((block) => [block.id, block]));
  assert.equal(byId.get('b_text').props.content.ar, 'مرحبا');
  assert.equal(byId.get('b_div').props.style, 'dashed');
  assert.equal(byId.get('b_spacer').heightMm, 12);
  assert.equal(byId.get('b_img').props.url, 'https://example.com/a.png');
  assert.equal(byId.get('b_qr').props.caption.en, 'Scan');
  assert.equal(byId.get('b_stamp').overlay.rotation, -12);
  assert.equal(byId.get('b_break').type, 'pageBreak');
});

test('an unsupported future document version is rejected with a clear error', () => {
  const contract = resolveTemplateContract(fixtures.simpleForm());
  const doc = new FormTemplate({
    ...contract.template,
    createdBy: OWNER,
    document: { ...contract.document, version: 99 }
  });
  const error = doc.validateSync();
  assert.ok(error, 'expected a validation error');
  assert.match(String(error.message), /Unsupported document layout version 99/);
});

test('field grid placement persists and stays in sync with the legacy width token', () => {
  const contract = resolveTemplateContract(fixtures.columnsForm());
  const stored = roundTrip({ ...contract.template, layoutVersion: DOCUMENT_VERSION, document: contract.document });
  const section = stored.sections.find((item) => item.id === 'section_columns');
  assert.ok(section.fields[0].grid);
  assert.equal(section.fields[0].grid.x, 0);
  assert.ok(section.fields[0].grid.w > 0);
  assert.ok(['full', 'half', 'third', 'two-thirds', 'quarter', 'three-quarters'].includes(section.fields[0].width));
});
