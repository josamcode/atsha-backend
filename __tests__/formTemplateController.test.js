/**
 * Template persistence behaviour that lives in the controller rather than the
 * schema: the config merge used by PUT, and the layout-version gate.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const controller = require('../controllers/formTemplateController');
const FormTemplate = require('../models/FormTemplate');
const fixtures = require('../utils/document/__fixtures__/templates');
const { resolveTemplateContract } = require('../utils/document/templateContract');

const { deepMergeConfig, assertRenderableDocument } = controller;

test('deepMergeConfig keeps sibling properties a partial update did not mention', () => {
  const current = {
    header: { enabled: true, showLogo: true, fontSize: 16, border: { show: true, width: 4, color: '#aaa' } },
    footer: { enabled: true, template: 'classic' }
  };
  const merged = deepMergeConfig(current, { header: { fontSize: 20 } });

  assert.equal(merged.header.fontSize, 20);
  assert.equal(merged.header.enabled, true, 'sibling flag must survive');
  assert.equal(merged.header.showLogo, true, 'sibling flag must survive');
  assert.equal(merged.header.border.width, 4, 'nested object must survive');
  assert.equal(merged.footer.template, 'classic', 'untouched branch must survive');
});

test('deepMergeConfig replaces arrays wholesale', () => {
  const merged = deepMergeConfig(
    { footer: { socialLinks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
    { footer: { socialLinks: [{ id: 'z' }] } }
  );
  assert.deepEqual(merged.footer.socialLinks, [{ id: 'z' }]);
});

test('deepMergeConfig accepts a Mongoose sub-document as the base', () => {
  const doc = new FormTemplate({
    ...fixtures.simpleForm(),
    createdBy: new mongoose.Types.ObjectId()
  });
  const merged = deepMergeConfig(doc.pdfStyle, { header: { fontSize: 22 } });
  assert.equal(merged.header.fontSize, 22);
  assert.equal(merged.header.showLogo, true);
  assert.equal(merged.footer.template, 'classic');
});

test('a partial pdfStyle update no longer resets the rest of the header', () => {
  // This is the exact regression the old one-level spread caused.
  const doc = new FormTemplate({
    ...fixtures.simpleForm(),
    createdBy: new mongoose.Types.ObjectId()
  });
  doc.pdfStyle.header.logoSize = 96;
  doc.pdfStyle.header.showDate = false;

  doc.pdfStyle = deepMergeConfig(doc.pdfStyle, { header: { enabled: false } });

  assert.equal(doc.pdfStyle.header.enabled, false);
  assert.equal(doc.pdfStyle.header.logoSize, 96, 'a previously customised value must not reset');
  assert.equal(doc.pdfStyle.header.showDate, false, 'a previously customised flag must not reset');
});

test('deepMergeConfig ignores prototype-polluting keys from a request body', () => {
  const merged = deepMergeConfig(
    { header: { fontSize: 16 } },
    JSON.parse('{"__proto__": {"polluted": "YES"}, "constructor": {"x": 1}, "header": {"fontSize": 20}}')
  );

  assert.equal(merged.header.fontSize, 20, 'the legitimate part of the patch still applies');
  assert.equal({}.polluted, undefined, 'Object.prototype must stay clean');
  assert.equal(merged.polluted, undefined, 'the merged object must not inherit a hijacked prototype');
  assert.equal(Object.prototype.hasOwnProperty.call(merged, 'constructor'), false);
});

test('deepMergeConfig leaves dates, arrays and nulls alone', () => {
  const when = new Date('2026-01-01T00:00:00.000Z');
  const merged = deepMergeConfig(
    { when: null, list: [1, 2, 3], nested: { keep: true } },
    { when, list: [9], nested: { added: 1 } }
  );
  assert.equal(merged.when, when);
  assert.deepEqual(merged.list, [9]);
  assert.deepEqual(merged.nested, { keep: true, added: 1 });
});

test('assertRenderableDocument accepts supported versions and no document', () => {
  assert.doesNotThrow(() => assertRenderableDocument(undefined));
  assert.doesNotThrow(() => assertRenderableDocument(null));
  assert.doesNotThrow(() => assertRenderableDocument({ version: 2, blocks: [] }));
});

test('assertRenderableDocument rejects a future version with a 400 and a clear message', () => {
  assert.throws(
    () => assertRenderableDocument({ version: 42, blocks: [] }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Unsupported document layout version 42/);
      assert.match(error.message, /update the application/i);
      return true;
    }
  );
});

test('a template saved by the builder reloads with an identical document', () => {
  const contract = resolveTemplateContract(fixtures.groupedTableForm());
  const doc = new FormTemplate({
    ...contract.template,
    layoutVersion: 2,
    createdBy: new mongoose.Types.ObjectId()
  });

  const stored = doc.toObject();
  const reloaded = resolveTemplateContract(stored);

  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.migrated, false, 'a v2 template must not be migrated again on read');
  assert.equal(
    JSON.stringify(reloaded.document.blocks.map((b) => [b.id, b.type, b.row, b.x, b.w, b.refId])),
    JSON.stringify(contract.document.blocks.map((b) => [b.id, b.type, b.row, b.x, b.w, b.refId]))
  );
});

test('create and update accept the same fields', () => {
  // `isActive` was accepted by PUT but silently dropped by POST.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'formTemplateController.js'),
    'utf8'
  );
  const createBody = /exports\.createFormTemplate[\s\S]*?\} = req\.body;/.exec(source)[0];
  const updateBody = /exports\.updateFormTemplate[\s\S]*?\} = req\.body;/.exec(source)[0];

  ['title', 'description', 'sections', 'departments', 'requiresApproval', 'isActive', 'layout', 'pdfStyle', 'document']
    .forEach((field) => {
      assert.match(createBody, new RegExp(`\\b${field}\\b`), `create must accept ${field}`);
      assert.match(updateBody, new RegExp(`\\b${field}\\b`), `update must accept ${field}`);
    });
});

test('a legacy template is left untouched in the database when merely read', () => {
  const legacy = fixtures.tableForm();
  const snapshot = JSON.stringify(legacy);
  const contract = resolveTemplateContract(legacy);

  assert.equal(contract.ok, true);
  assert.equal(contract.migrated, true);
  assert.equal(JSON.stringify(legacy), snapshot, 'the stored object must not be mutated by reading it');
  assert.equal(legacy.document, undefined, 'no document is written back on read');
  assert.equal(legacy.layoutVersion, undefined);
});
