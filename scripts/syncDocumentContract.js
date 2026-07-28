#!/usr/bin/env node
/**
 * Sync the shared document contract from the frontend (canonical) into the
 * backend mirror.
 *
 * The browser and the PDF generator must agree byte-for-byte on layout, so the
 * contract is authored ONCE in `frontend/src/document/` and copied verbatim into
 * `backend/utils/document/`. The modules are plain CommonJS with no runtime
 * dependencies, so no transform is needed — which is exactly what makes the copy
 * safe to verify with a checksum.
 *
 *   node scripts/syncDocumentContract.js            # copy + report
 *   node scripts/syncDocumentContract.js --check    # verify only, exit 1 on drift
 *
 * `--check` is what the test suite runs; the copy mode is what a developer runs
 * after editing the contract. The frontend checkout is not present in the
 * deployed Docker image, so `--check` reports "skipped" there instead of failing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'frontend', 'src', 'document');
const TARGET_DIR = path.join(__dirname, '..', 'utils', 'document');

const FILES = [
  'units.js',
  'textMetrics.js',
  'documentModel.js',
  'migrate.js',
  'templateContract.js',
  'sampleData.js',
  'layoutEngine.js',
  path.join('__fixtures__', 'templates.js')
];

const checkMode = process.argv.includes('--check');

const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

const run = () => {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.log('[document-contract] frontend source not available — skipping (deployed image).');
    return 0;
  }

  let drift = 0;
  FILES.forEach((relative) => {
    const source = path.join(SOURCE_DIR, relative);
    const target = path.join(TARGET_DIR, relative);

    if (!fs.existsSync(source)) {
      console.error(`[document-contract] MISSING SOURCE ${relative}`);
      drift += 1;
      return;
    }

    const sourceBuffer = fs.readFileSync(source);
    const targetExists = fs.existsSync(target);
    const targetBuffer = targetExists ? fs.readFileSync(target) : null;

    if (targetExists && sourceBuffer.equals(targetBuffer)) {
      console.log(`[document-contract] ok       ${relative} (${hash(sourceBuffer)})`);
      return;
    }

    if (checkMode) {
      console.error(`[document-contract] DRIFT    ${relative} — run: node scripts/syncDocumentContract.js`);
      drift += 1;
      return;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, sourceBuffer);
    console.log(`[document-contract] ${targetExists ? 'updated' : 'created'}  ${relative} (${hash(sourceBuffer)})`);
  });

  if (drift > 0) {
    console.error(`\n[document-contract] ${drift} file(s) out of sync with frontend/src/document.`);
    return 1;
  }
  return 0;
};

const exitCode = run();
if (require.main === module) {
  process.exit(exitCode);
}
module.exports = { run, FILES, SOURCE_DIR, TARGET_DIR };
