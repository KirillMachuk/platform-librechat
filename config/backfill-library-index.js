const path = require('path');
const { logger, runAsSystem } = require('@librechat/data-schemas');

require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const connect = require('./connect');
const { withLibraryVisibility } = require('~/app/clients/tools/util/librarySearch');

const { File } = require('~/db/models');

/**
 * Cap on retained per-file sample entries in `results.details` — aggregate
 * counts stay accurate on large corpora; we just stop accumulating samples.
 */
const DETAIL_SAMPLE_LIMIT = 50;

/**
 * Backfill for cross-chat library_search: enqueue every existing full-text
 * `context` document for async embedding into pgvector so it becomes findable
 * across chats. Newly uploaded context files are enqueued at upload time
 * (process.js); this one-off closes the gap for documents uploaded before the
 * feature shipped.
 *
 * Selection (idempotent — safe to re-run):
 *   - `embedded !== true`               not already in the vector store
 *   - `embeddingStatus` absent          not already queued/ready (leaves 'failed'
 *                                        and in-flight records untouched)
 *   - `text` present                    it is a context file (has extracted text)
 *   - `source !== 'text'`               a durable ORIGINAL is retained, so the
 *                                        background /embed can stream it (legacy
 *                                        text-source records have no original)
 *   - library visibility                same rule the search scope uses (withLibraryVisibility):
 *                                        temp files never, retention-dated files while alive
 *   - `project_id: null`                not a project source (own namespace)
 *
 * The async embed worker (RAG_ASYNC_EMBED=true) drains the queue afterwards;
 * on a large corpus this runs for a while (each file is re-parsed/re-OCR'd by
 * the doc-gateway — `File.text` cannot be reused by rag_api's /embed). It is
 * fully background and never blocks users.
 *
 * @param {{ dryRun?: boolean, batchSize?: number }} [options]
 */
async function backfillLibraryIndex({ dryRun = true, batchSize = 100 } = {}) {
  await connect();

  logger.info('Starting Library Index Backfill', { dryRun, batchSize });

  return runAsSystem(async () => {
    const selector = withLibraryVisibility({
      embedded: { $ne: true },
      embeddingStatus: { $exists: false },
      text: { $exists: true, $ne: null },
      source: { $ne: 'text' },
      project_id: null,
    });

    const total = await File.countDocuments(selector);
    logger.info(`Found ${total} context file(s) eligible for library indexing`);

    const results = { dryRun, scanned: 0, enqueued: 0, errors: 0, details: [] };

    /* Collect the target set FIRST, then write — never mutate inside the cursor.
     * The update sets `embeddingStatus` (an indexed field in the selector), so a
     * non-snapshot cursor whose plan uses that index could skip documents
     * mid-iteration (the "Halloween problem") → silent partial backfill. Reading
     * to completion before any write removes that hazard entirely. */
    const targets = [];
    const cursor = File.find(selector, { file_id: 1, filename: 1, embedEntityId: 1 })
      .lean()
      .cursor({ batchSize });
    for await (const file of cursor) {
      results.scanned++;
      if (!file.file_id) {
        continue;
      }
      targets.push(file);
      if (results.details.length < DETAIL_SAMPLE_LIMIT) {
        results.details.push({ file_id: file.file_id, filename: file.filename });
      }
    }

    if (!dryRun) {
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        const ops = batch.map((file) => ({
          updateOne: {
            filter: { file_id: file.file_id },
            update: {
              $set: {
                embeddingStatus: 'pending',
                embedNextAt: new Date(),
                embedAttempts: 0,
                embeddingScope: 'library',
                ...(file.embedEntityId ? { embedEntityId: file.embedEntityId } : {}),
              },
              $unset: { expiresAt: '' },
            },
          },
        }));
        try {
          const res = await File.bulkWrite(ops, { ordered: false });
          results.enqueued += res.modifiedCount ?? 0;
        } catch (error) {
          results.errors += batch.length;
          logger.error(`Backfill batch failed (offset ${i})`, { error: error.message });
        }
      }
    }

    logger.info('Library Index Backfill completed', {
      dryRun,
      scanned: results.scanned,
      enqueued: results.enqueued,
      errors: results.errors,
    });

    return results;
  });
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const batchSize =
    parseInt(process.argv.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1]) || 100;

  backfillLibraryIndex({ dryRun, batchSize })
    .then((result) => {
      console.log(`\n=== ${dryRun ? 'DRY RUN ' : ''}RESULTS ===`);
      console.log(`Files scanned: ${result.scanned}`);
      console.log(
        `Files ${dryRun ? 'to enqueue' : 'enqueued'}: ${dryRun ? result.scanned : result.enqueued}`,
      );
      if (result.errors > 0) {
        console.log(`Errors: ${result.errors}`);
      }
      if (result.details.length > 0) {
        console.log('\nSample:');
        result.details.forEach((d, i) => console.log(`  ${i + 1}. ${d.filename} (${d.file_id})`));
        if (result.scanned > result.details.length) {
          console.log(`  ... and ${result.scanned - result.details.length} more (sample capped)`);
        }
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('Library index backfill failed:', error);
      process.exit(1);
    });
}

module.exports = { backfillLibraryIndex };
