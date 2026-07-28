/**
 * Server PDF generation.
 *
 * The generator is a thin executor of the shared layout engine, so these tests
 * assert two things:
 *   1. it really produces a valid, correctly sized, multi-page PDF, and
 *   2. its page geometry and pagination are IDENTICAL to what the browser
 *      renderer will be handed for the same template.
 *
 * Run with: node --test __tests__
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pdfGenerator = require('../utils/pdfGenerator');
const fixtures = require('../utils/document/__fixtures__/templates');
const { resolveTemplateContract } = require('../utils/document/templateContract');
const { layoutDocument } = require('../utils/document/layoutEngine');
const { buildSampleValues, buildSampleInstance } = require('../utils/document/sampleData');

const instanceFor = (template, language = 'en') => {
  const contract = resolveTemplateContract(template);
  return {
    ...buildSampleInstance(template, language),
    _id: '65f0000000000000000000aa',
    values: buildSampleValues(contract, language)
  };
};

/** Page boxes declared in the PDF, in points. */
const readMediaBoxes = (buffer) => {
  const text = buffer.toString('latin1');
  const matches = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  return matches.map((match) => ({ width: Number(match[3]), height: Number(match[4]) }));
};

const countPages = (buffer) => {
  const text = buffer.toString('latin1');
  const countMatch = /\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(text);
  if (countMatch) return Number(countMatch[1]);
  return (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
};

test('the embedded Arabic font is present', () => {
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'fonts', 'NotoSansArabic-Regular.ttf')),
    'fonts/NotoSansArabic-Regular.ttf must ship with the backend for Arabic exports'
  );
});

test('produces a valid A4 PDF for a simple form', async () => {
  const template = fixtures.simpleForm();
  const buffer = await pdfGenerator.generateFormPDF(instanceFor(template), template, null, 'en');

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 1000, 'PDF should not be empty');

  const boxes = readMediaBoxes(buffer);
  assert.ok(boxes.length > 0, 'expected at least one MediaBox');
  boxes.forEach((box) => {
    assert.ok(Math.abs(box.width - 595.276) < 0.5, `width ${box.width}`);
    assert.ok(Math.abs(box.height - 841.89) < 0.5, `height ${box.height}`);
  });
});

test('honours page size and orientation', async () => {
  const template = fixtures.simpleForm();
  template.layout.pageSize = 'Legal';
  template.layout.orientation = 'landscape';
  const buffer = await pdfGenerator.generateFormPDF(instanceFor(template), template, null, 'en');
  const boxes = readMediaBoxes(buffer);
  assert.ok(Math.abs(boxes[0].width - 1008) < 0.5, `width ${boxes[0].width}`);
  assert.ok(Math.abs(boxes[0].height - 612) < 0.5, `height ${boxes[0].height}`);
});

test('the PDF page count matches the shared engine exactly', async () => {
  const template = fixtures.multiPageForm();
  const instance = instanceFor(template);

  const layout = pdfGenerator.layoutForInstance(instance, template, 'en');
  const buffer = await pdfGenerator.generateFormPDF(instance, template, null, 'en');

  assert.ok(layout.pageCount > 1, 'fixture should span multiple pages');
  assert.equal(countPages(buffer), layout.pageCount);
});

test('server layout is identical to what the browser renderer receives', () => {
  const template = fixtures.groupedTableForm();
  const instance = instanceFor(template);

  const serverLayout = pdfGenerator.layoutForInstance(instance, template, 'en');

  // Exactly the call the React DocumentRenderer makes.
  const contract = resolveTemplateContract({
    ...template,
    pdfStyle: pdfGenerator.buildPdfStyle(template, null)
  });
  const browserLayout = layoutDocument({
    contract,
    values: instance.values,
    formInstance: instance,
    language: 'en',
    mode: 'print'
  });

  assert.equal(serverLayout.pageCount, browserLayout.pageCount);
  assert.equal(
    JSON.stringify(serverLayout.pages),
    JSON.stringify(browserLayout.pages),
    'server and browser must execute the same primitives'
  );
});

test('renders Arabic content and embeds a font subset', async () => {
  const template = fixtures.longArabicForm();
  const buffer = await pdfGenerator.generateFormPDF(instanceFor(template, 'ar'), template, null, 'ar');

  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const text = buffer.toString('latin1');
  assert.match(text, /\/FontFile2/, 'a TrueType font must be embedded for Arabic');
  assert.match(text, /NotoSansArabic/, 'the Arabic face must be the embedded one');
});

test('English and Arabic exports paginate the same fixture consistently', () => {
  const template = fixtures.longEnglishForm();
  const en = pdfGenerator.layoutForInstance(instanceFor(template, 'en'), template, 'en');
  const ar = pdfGenerator.layoutForInstance(instanceFor(template, 'ar'), template, 'ar');

  assert.ok(en.pageCount >= 1);
  assert.ok(ar.pageCount >= 1);
  en.pages.forEach((page) => assert.ok(page.primitives.length > 0));
  ar.pages.forEach((page) => assert.ok(page.primitives.length > 0));
  // Every Arabic text primitive must be flagged RTL so the executor mirrors it.
  ar.pages.forEach((page) => {
    page.primitives
      .filter((primitive) => primitive.k === 'text')
      .forEach((primitive) => assert.equal(primitive.rtl, true));
  });
});

test('renders a grouped table with a repeated header across pages', async () => {
  const template = fixtures.multiPageForm();
  const layout = pdfGenerator.layoutForInstance(instanceFor(template), template, 'en');
  const pagesShowingHeader = layout.pages.filter((page) => page.primitives.some(
    (primitive) => primitive.k === 'text' && primitive.lines.includes('Event')
  ));
  assert.ok(pagesShowingHeader.length > 1, 'table header should repeat on continuation pages');

  const buffer = await pdfGenerator.generateFormPDF(instanceFor(template), template, null, 'en');
  assert.ok(buffer.length > 2000);
});

test('an image-heavy document exports without failing on unreachable images', async () => {
  const template = fixtures.imageHeavyForm();
  const instance = instanceFor(template);
  // Point one field at an unreachable host to prove failures degrade gracefully.
  instance.values['section_images.photo_0'] = { url: 'https://127.0.0.1:9/nope.png' };

  const buffer = await pdfGenerator.generateFormPDF(instance, template, null, 'en');
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
});

test('a template with an unsupported document version is refused with 422', async () => {
  const template = fixtures.simpleForm();
  template.document = { version: 99, page: {}, grid: {}, blocks: [] };

  await assert.rejects(
    () => pdfGenerator.generateFormPDF(instanceFor(template), template, null, 'en'),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /Unsupported document layout version 99/);
      return true;
    }
  );
});

test('exporting without a template fails loudly instead of producing a blank PDF', async () => {
  await assert.rejects(
    () => pdfGenerator.generateFormPDF({}, null, null, 'en'),
    /template no longer exists/
  );
});

test('rgba colours from the theme are converted for PDFKit', () => {
  assert.equal(pdfGenerator.normalizeColor('rgba(1, 200, 83, 0.2)'), '#01c853');
  assert.equal(pdfGenerator.normalizeColor('#abcdef'), '#abcdef');
  assert.equal(pdfGenerator.normalizeColor('transparent'), null);
  assert.equal(pdfGenerator.normalizeColor(undefined, '#000000'), '#000000');
});

test('a 100+ component template exports in reasonable time', async () => {
  const template = fixtures.largeForm(30, 4);
  const started = Date.now();
  const buffer = await pdfGenerator.generateFormPDF(instanceFor(template), template, null, 'en');
  const elapsed = Date.now() - started;
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(elapsed < 20000, `export took ${elapsed}ms`);
});
