/**
 * Rollback safety for the layout-v2 migration script.
 *
 * `--rollback` must be able to undo what the script did without destroying a
 * document that was designed in the visual builder — that document has no v1
 * equivalent to fall back to, so un-setting it would lose the design.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isScriptGenerated } = require('../scripts/migrateTemplatesToLayoutV2');
const { resolveTemplateContract } = require('../utils/document/templateContract');
const { createBlock } = require('../utils/document/documentModel');
const fixtures = require('../utils/document/__fixtures__/templates');

test('a script-converted template is recognised as revertible', () => {
  const contract = resolveTemplateContract(fixtures.multiSectionForm());
  assert.equal(isScriptGenerated(contract.template), true);
});

test('every representative fixture converts to a revertible document', () => {
  Object.entries(fixtures.allFixtures()).forEach(([name, template]) => {
    const contract = resolveTemplateContract(template);
    assert.equal(isScriptGenerated(contract.template), true, `${name} must be revertible`);
  });
});

test('a document with an author-added block is NOT reverted', () => {
  const contract = resolveTemplateContract(fixtures.simpleForm());
  contract.template.document.blocks.push(createBlock('text', {
    placement: 'flow', row: 99, x: 0, w: 24
  }));
  assert.equal(
    isScriptGenerated(contract.template),
    false,
    'a builder-authored block must protect the whole document from rollback'
  );
});

test('a template with no document is not revertible', () => {
  assert.equal(isScriptGenerated(fixtures.simpleForm()), false);
  assert.equal(isScriptGenerated({ document: { blocks: [] } }), false);
  assert.equal(isScriptGenerated({}), false);
  assert.equal(isScriptGenerated(null), false);
});

test('a duplicated section id still yields derivable block ids', () => {
  const template = fixtures.simpleForm();
  template.sections = [
    { ...template.sections[0], id: 'dupe' },
    { ...template.sections[0], id: 'dupe', fields: [] }
  ];
  template.layout.sectionOrder = ['dupe', 'dupe'];

  const contract = resolveTemplateContract(template);
  assert.equal(isScriptGenerated(contract.template), true);
});

test('the migration writes only document and layoutVersion', () => {
  // Guards the rollback contract: if the script ever starts rewriting sections
  // again, `$unset` of two paths stops being a complete revert.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'migrateTemplatesToLayoutV2.js'),
    'utf8'
  );
  const setBlock = /\$set:\s*\{([^}]*)\}/.exec(source);
  assert.ok(setBlock, 'the script must contain a $set');
  assert.match(setBlock[1], /document/);
  assert.match(setBlock[1], /layoutVersion/);
  assert.doesNotMatch(setBlock[1], /sections/, '`sections` must not be rewritten by the migration');
});
