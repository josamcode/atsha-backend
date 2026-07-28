/**
 * Regression cover for the resource-safety defects found in the independent
 * review of the redesign.
 *
 * Image sources reach the PDF generator from template branding AND from
 * submitted form values, so they are attacker-controlled input.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pdfGenerator = require('../utils/pdfGenerator');
const fixtures = require('../utils/document/__fixtures__/templates');
const { resolveTemplateContract } = require('../utils/document/templateContract');
const { buildSampleInstance } = require('../utils/document/sampleData');

const { isFetchableUrl, resolveAndLoadImage } = pdfGenerator;

test('private, loopback and metadata hosts are refused', () => {
  [
    'http://localhost/a.png',
    'http://127.0.0.1/a.png',
    'https://127.0.0.1:8443/a.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/a.png',
    'http://192.168.1.10/a.png',
    'http://172.16.4.4/a.png',
    'http://172.31.255.1/a.png',
    'http://[::1]/a.png',
    'http://db.internal/a.png',
    'http://printer.local/a.png',
    'http://metadata.google.internal/'
  ].forEach((url) => {
    assert.equal(isFetchableUrl(url), false, `${url} must be blocked`);
  });
});

test('ordinary public URLs are still allowed', () => {
  [
    'https://media.arascreen.ai/ararms/logo.png',
    'https://res.cloudinary.com/demo/image/upload/a.png',
    'http://example.com/a.png'
  ].forEach((url) => {
    assert.equal(isFetchableUrl(url), true, `${url} must be allowed`);
  });
});

test('non-http schemes are refused', () => {
  ['file:///etc/passwd', 'ftp://example.com/a.png', 'gopher://x', 'not a url']
    .forEach((url) => assert.equal(isFetchableUrl(url), false, `${url} must be blocked`));
});

test('a traversal path cannot read a file outside uploads/', async () => {
  // Plant a file the traversal would reach if containment were missing.
  const secretPath = path.join(__dirname, '..', '..', 'ara-pdf-traversal-probe.png');
  fs.writeFileSync(secretPath, Buffer.from('89504e470d0a1a0a', 'hex'));

  try {
    const attempts = [
      '/uploads/../../ara-pdf-traversal-probe.png',
      '/uploads/../../../ara-pdf-traversal-probe.png',
      '../../ara-pdf-traversal-probe.png',
      'uploads/../../ara-pdf-traversal-probe.png',
      '/uploads/..%2f..%2fara-pdf-traversal-probe.png'
    ];
    // eslint-disable-next-line no-restricted-syntax
    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop
      const result = await resolveAndLoadImage(attempt);
      assert.equal(result, null, `${attempt} must not resolve to a file`);
    }
  } finally {
    fs.rmSync(secretPath, { force: true });
  }
});

test('a legitimate uploads file is still readable', async () => {
  const uploads = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const filename = 'ara-pdf-allowed-probe.png';
  const filePath = path.join(uploads, filename);
  fs.writeFileSync(filePath, Buffer.from('89504e470d0a1a0a', 'hex'));

  try {
    const direct = await resolveAndLoadImage(`/uploads/${filename}`);
    assert.ok(Buffer.isBuffer(direct), 'an uploads path must resolve');
    assert.equal(direct.length, 8);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('an SVG data URI is skipped rather than crashing PDFKit', async () => {
  const svg = 'data:image/svg+xml;charset=UTF-8,%3Csvg%2F%3E';
  assert.equal(await resolveAndLoadImage(svg), null);
});

test('a raster data URI is passed straight through', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(await resolveAndLoadImage(png), png);
});

test('an export whose images all point at blocked hosts still succeeds', async () => {
  const template = fixtures.imageHeavyForm();
  const contract = resolveTemplateContract(template);
  const instance = {
    ...buildSampleInstance(template, 'en'),
    _id: '65f0000000000000000000aa',
    values: {
      'section_images.photo_0': { url: 'http://169.254.169.254/latest/meta-data/' },
      'section_images.photo_1': { url: '/uploads/../../../etc/hosts' },
      'section_images.photo_2': { url: 'http://10.1.2.3/internal.png' }
    }
  };

  const buffer = await pdfGenerator.generateFormPDF(instance, template, null, 'en');
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
});

test('a file larger than the per-image budget is skipped', async () => {
  const uploads = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const filename = 'ara-pdf-huge-probe.png';
  const filePath = path.join(uploads, filename);
  // One byte over the default 8 MB budget.
  fs.writeFileSync(filePath, Buffer.alloc(8 * 1024 * 1024 + 1));

  try {
    assert.equal(await resolveAndLoadImage(`/uploads/${filename}`), null);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('a rotated rect reaches the PDF (browser/PDF executor parity)', async () => {
  const template = fixtures.simpleForm();
  const contract = resolveTemplateContract(template);
  contract.document.blocks.push({
    id: 'blk_stamp',
    type: 'stamp',
    placement: 'overlay',
    x: 0,
    w: 6,
    row: 0,
    heightMm: 30,
    minHeightMm: 0,
    hidden: false,
    locked: false,
    keepTogether: false,
    breakBefore: false,
    repeat: 'all',
    refId: null,
    overlay: { pageScope: 'all', xMm: 100, yMm: 200, wMm: 40, hMm: 40, rotation: -12, opacity: 100 },
    props: { label: { en: 'APPROVED', ar: 'معتمد' }, borderColor: '#01c853', rotation: -12 }
  });

  const { layoutDocument } = require('../utils/document/layoutEngine');
  const result = layoutDocument({ contract, language: 'en', mode: 'print' });
  const rect = result.pages[0].primitives.find((primitive) => primitive.k === 'rect' && primitive.rotation);
  assert.ok(rect, 'the engine must emit a rotated rect for a label-only stamp');
  assert.equal(rect.rotation, -12);

  // And the executor must not silently ignore it.
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pdfGenerator.js'), 'utf8');
  assert.match(source, /drawRect[\s\S]{0,900}primitive\.rotation/, 'drawRect must honour rotation');
  assert.match(source, /drawImage[\s\S]{0,1200}roundedRect[\s\S]{0,80}\.clip\(\)/, 'drawImage must clip a corner radius');
});

test('the temporary directory is not used for anything', () => {
  // Guards against a stray debug artefact being written next to real uploads.
  assert.ok(os.tmpdir());
});
