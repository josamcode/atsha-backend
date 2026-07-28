/**
 * The shared document contract must be byte-identical in both projects.
 *
 * The browser and the PDF generator run the SAME layout code; if the two copies
 * drift, "the builder disagrees with the PDF" becomes possible again. This test
 * is the guard.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { FILES, SOURCE_DIR, TARGET_DIR } = require('../scripts/syncDocumentContract');
const { layoutDocument } = require('../utils/document/layoutEngine');
const { resolveTemplateContract } = require('../utils/document/templateContract');
const { buildSampleValues, buildSampleInstance } = require('../utils/document/sampleData');
const fixtures = require('../utils/document/__fixtures__/templates');

test('the backend mirror matches the frontend source exactly', (t) => {
  if (!fs.existsSync(SOURCE_DIR)) {
    t.skip('frontend checkout not present (expected inside the deployed image)');
    return;
  }

  const drift = FILES.filter((relative) => {
    const source = path.join(SOURCE_DIR, relative);
    const target = path.join(TARGET_DIR, relative);
    if (!fs.existsSync(source) || !fs.existsSync(target)) return true;
    return !fs.readFileSync(source).equals(fs.readFileSync(target));
  });

  assert.deepEqual(
    drift,
    [],
    `Out of sync with frontend/src/document. Run: npm run sync:document-contract\nDrifted: ${drift.join(', ')}`
  );
});

test('every shared module loads without a browser or Node-only global', () => {
  FILES.forEach((relative) => {
    const loaded = require(path.join(TARGET_DIR, relative));
    assert.equal(typeof loaded, 'object', `${relative} must export an object`);
  });
});

test('the engine lays out every representative fixture', () => {
  const all = fixtures.allFixtures();
  Object.entries(all).forEach(([name, template]) => {
    ['en', 'ar'].forEach((language) => {
      const contract = resolveTemplateContract(template);
      assert.equal(contract.ok, true, `${name} (${language}) contract`);

      const result = layoutDocument({
        contract,
        values: buildSampleValues(contract, language),
        formInstance: buildSampleInstance(template, language),
        language,
        mode: 'print'
      });

      assert.equal(result.ok, true, `${name} (${language}) layout`);
      assert.ok(result.pageCount >= 1, `${name} (${language}) must produce at least one page`);
      result.pages.forEach((page) => {
        assert.ok(page.widthPt > 0 && page.heightPt > 0, `${name} page dimensions`);
        page.primitives.forEach((primitive) => {
          assert.ok(Number.isFinite(primitive.x ?? primitive.x1 ?? 0), `${name} finite x`);
          assert.ok(Number.isFinite(primitive.y ?? primitive.y1 ?? 0), `${name} finite y`);
        });
      });
    });
  });
});

test('layout is deterministic across repeated runs', () => {
  const template = fixtures.multiPageForm();
  const run = () => {
    const contract = resolveTemplateContract(template);
    return JSON.stringify(layoutDocument({
      contract,
      values: buildSampleValues(contract, 'en'),
      formInstance: buildSampleInstance(template, 'en'),
      language: 'en',
      mode: 'print'
    }).pages);
  };
  assert.equal(run(), run());
});

test('a fixture with 100+ components lays out quickly on the server', () => {
  const template = fixtures.largeForm(40, 4);
  const contract = resolveTemplateContract(template);
  const started = Date.now();
  const result = layoutDocument({ contract, language: 'en', mode: 'print' });
  const elapsed = Date.now() - started;

  assert.equal(result.ok, true);
  assert.ok(result.pageCount > 1);
  assert.ok(elapsed < 3000, `layout took ${elapsed}ms`);
});
