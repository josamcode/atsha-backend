/**
 * Materialise the layout-v2 visual document for existing form templates.
 *
 * This migration is OPTIONAL. Every consumer already adapts a layout-v1 template
 * at read time (`resolveTemplateContract`), so nothing breaks if it never runs.
 * Its purpose is to let an operator convert a tenant ahead of time — for example
 * before a support session — and to make the conversion auditable.
 *
 * Safety rules this script follows:
 *   - It only ever ADDS `document` and `layoutVersion`. `sections` is never
 *     rewritten (field grids are derived at read time anyway), so a rollback is
 *     exactly `$unset` of those two paths and nothing else.
 *   - Templates that already carry a v2 document are skipped.
 *   - The conversion is the same deterministic adapter the app uses at read time,
 *     so a converted template renders byte-identically to an unconverted one.
 *   - `--rollback` only reverts documents THIS SCRIPT produced. A document
 *     designed in the visual builder has no v1 equivalent to fall back to, so
 *     un-setting it would destroy the design; those are skipped and reported.
 *
 *   node scripts/migrateTemplatesToLayoutV2.js --dry-run
 *   node scripts/migrateTemplatesToLayoutV2.js
 *   node scripts/migrateTemplatesToLayoutV2.js --organization=<id>
 *   node scripts/migrateTemplatesToLayoutV2.js --rollback
 */

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const FormTemplate = require('../models/FormTemplate');
const { resolveTemplateContract } = require('../utils/document/templateContract');
const { DOCUMENT_VERSION } = require('../utils/document/documentModel');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isDryRun = process.argv.includes('--dry-run');
const isRollback = process.argv.includes('--rollback');

const getArgValue = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
};

const buildQuery = () => {
  const query = {};
  const organizationId = getArgValue('organization');
  if (organizationId) {
    query.organizationId = new mongoose.Types.ObjectId(organizationId);
  }
  return query;
};

/**
 * Is this document exactly what `buildDocumentFromLegacy` would produce?
 *
 * The adapter derives every block id from the template's own content, so a
 * document whose blocks all carry derivable ids can be safely discarded and
 * rebuilt. Anything else was authored in the builder and must be left alone.
 */
const isScriptGenerated = (template) => {
  const blocks = template?.document?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return false;
  }
  const expected = new Set(['blk_header', 'blk_metadata', 'blk_signature', 'blk_footer', 'blk_watermark']);
  (template.sections || []).forEach((section, index) => {
    expected.add(`blk_section_${section.id}`);
    expected.add(`blk_section_${section.id}__${index}`);
  });
  return blocks.every((block) => expected.has(block.id));
};

const rollback = async (query) => {
  const target = { ...query, layoutVersion: DOCUMENT_VERSION };
  const total = await FormTemplate.countDocuments(target);
  console.log(`Templates carrying a v2 document: ${total}`);

  const cursor = FormTemplate.find(target).cursor();
  let reverted = 0;
  let preserved = 0;

  // eslint-disable-next-line no-restricted-syntax
  for await (const template of cursor) {
    const plain = template.toObject();
    const title = plain.title?.en || plain.title?.ar || String(plain._id);

    if (!isScriptGenerated(plain)) {
      preserved += 1;
      console.log(`- preserved ${title} (designed in the builder; reverting would destroy the layout)`);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (isDryRun) {
      reverted += 1;
      console.log(`[dry-run] would $unset document and layoutVersion on ${title}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await FormTemplate.updateOne({ _id: plain._id }, { $unset: { document: '', layoutVersion: '' } });
    reverted += 1;
    console.log(`✓ reverted ${title}`);
  }

  console.log('\n--- summary ---');
  console.log(`reverted:  ${reverted}`);
  console.log(`preserved: ${preserved}`);
  console.log('Reverted templates fall back to the read-time v1 adapter; no other property was touched.');
};

const migrate = async (query) => {
  const total = await FormTemplate.countDocuments(query);
  console.log(`Templates in scope: ${total}`);

  const cursor = FormTemplate.find(query).cursor();
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  // eslint-disable-next-line no-restricted-syntax
  for await (const template of cursor) {
    const plain = template.toObject();
    const title = plain.title?.en || plain.title?.ar || String(plain._id);

    if (Number(plain.layoutVersion) === DOCUMENT_VERSION && plain.document?.blocks?.length) {
      skipped += 1;
      console.log(`- skipped  ${title} (already layout v${DOCUMENT_VERSION})`);
      // eslint-disable-next-line no-continue
      continue;
    }

    const contract = resolveTemplateContract(plain);
    if (!contract.ok) {
      failed += 1;
      console.error(`x failed   ${title}: ${contract.error?.message || 'unknown error'}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (isDryRun) {
      converted += 1;
      console.log(`[dry-run] would convert ${title} → ${contract.document.blocks.length} blocks, ${contract.document.page.size} ${contract.document.page.orientation}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    try {
      // Only `document` and `layoutVersion` are written. Field grids are derived
      // at read time, so rewriting `sections` here would buy nothing and would
      // make the rollback incomplete.
      const result = await FormTemplate.updateOne(
        { _id: plain._id },
        { $set: { document: contract.document, layoutVersion: DOCUMENT_VERSION } },
        { runValidators: true }
      );
      if (result.modifiedCount > 0) {
        converted += 1;
        console.log(`✓ converted ${title} (${contract.document.blocks.length} blocks)`);
      } else {
        skipped += 1;
        console.log(`- skipped  ${title} (no change)`);
      }
    } catch (error) {
      failed += 1;
      console.error(`x failed   ${title}: ${error.message}`);
    }
  }

  console.log('\n--- summary ---');
  console.log(`converted: ${converted}`);
  console.log(`skipped:   ${skipped}`);
  console.log(`failed:    ${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
};

const run = async () => {
  await connectDB();
  const query = buildQuery();
  console.log(`Mode: ${isRollback ? 'rollback' : 'migrate'}${isDryRun ? ' (dry run)' : ''}`);
  console.log(`Query: ${JSON.stringify(query)}`);

  if (isRollback) {
    await rollback(query);
    return;
  }
  await migrate(query);
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Layout v2 migration failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

// Exported so the rollback safety rule can be tested without a database.
module.exports = { run, migrate, rollback, isScriptGenerated };
