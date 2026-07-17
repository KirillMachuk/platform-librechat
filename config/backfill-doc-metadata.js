const path = require('path');
const { logger, runAsSystem } = require('@librechat/data-schemas');
const { createConcurrencyLimiter } = require('@librechat/api');

require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const connect = require('./connect');
const { withLibraryVisibility } = require('~/app/clients/tools/util/librarySearch');
const { fetchDocMetadata } = require('~/server/services/Files/Embed/crud');
const { getAppConfig } = require('~/server/services/Config');

const { File } = require('~/db/models');

/** Cap on retained per-file sample entries — aggregate counts stay accurate on large corpora. */
const DETAIL_SAMPLE_LIMIT = 50;

/**
 * Backfill of document metadata (type, parties, own date/place, identifiers) for files that were
 * already indexed before the feature shipped. New uploads get theirs from the embed worker.
 *
 * These fields answer enumeration queries ("all contracts with X", "briefs from 2025") that
 * retrieval cannot: top-K does not fit a set (measured: dense top-5 set-recall 0.54 vs filter
 * 1.00 — parser-bench/rag-recall/RESULTS_META.md).
 *
 * Selection (idempotent — safe and cheap to re-run):
 *   - `embedded: true`            in the vector store, i.e. actually part of the library
 *   - `docMetadata` absent        not extracted yet — a failed file is simply picked up next run
 *   - library visibility          same rule the search scope uses (`withLibraryVisibility`):
 *                                 temp files never, retention-dated files yes while alive
 *
 * Re-running IS the retry strategy: extraction is fail-open (a busy doc-gateway answers 503 →
 * null → the file keeps no metadata and stays selected). Run until `remaining` reaches 0.
 *
 * Cost: the doc-gateway caches its parse by content hash, so PDFs indexed earlier are usually a
 * cache hit; a cold cache (fresh container) re-parses, which for scans means OCR. Fully
 * background — it never blocks users, and a file without metadata stays fully searchable.
 *
 * @param {{ dryRun?: boolean, batchSize?: number, concurrency?: number, limit?: number }} [options]
 */
async function backfillDocMetadata({
  dryRun = true,
  batchSize = 100,
  concurrency = 2,
  limit = 0,
} = {}) {
  await connect();

  logger.info('Starting Document Metadata Backfill', { dryRun, batchSize, concurrency, limit });

  return runAsSystem(async () => {
    if (!process.env.RAG_API_URL) {
      throw new Error('RAG_API_URL not defined — the doc-gateway serves /metadata');
    }
    if (
      !['true', '1', 'yes', 'on'].includes(
        (process.env.LIBRARY_METADATA_ENABLED ?? '').toLowerCase(),
      )
    ) {
      throw new Error(
        'LIBRARY_METADATA_ENABLED is off — extraction would be skipped for every file',
      );
    }

    const appConfig = await getAppConfig();
    const selector = withLibraryVisibility({
      embedded: true,
      docMetadata: { $exists: false },
    });

    const total = await File.countDocuments(selector);
    logger.info(`Found ${total} indexed file(s) without document metadata`);

    const results = { dryRun, scanned: 0, extracted: 0, skipped: 0, remaining: 0, details: [] };

    /* Collect the target set FIRST, then write — never mutate inside the cursor. The update sets
     * `docMetadata`, which the selector filters on, so a non-snapshot cursor could skip documents
     * mid-iteration (the "Halloween problem") → silent partial backfill. */
    const targets = [];
    const cursor = File.find(selector, {
      file_id: 1,
      filename: 1,
      filepath: 1,
      source: 1,
      type: 1,
      user: 1,
    })
      .lean()
      .cursor({ batchSize });
    for await (const file of cursor) {
      results.scanned++;
      if (!file.file_id || !file.filepath) {
        continue;
      }
      targets.push(file);
      if (limit && targets.length >= limit) {
        break;
      }
    }

    if (dryRun) {
      results.details = targets
        .slice(0, DETAIL_SAMPLE_LIMIT)
        .map((file) => ({ file_id: file.file_id, filename: file.filename }));
      results.remaining = targets.length;
      logger.info('Document Metadata Backfill completed (dry run)', results);
      return results;
    }

    /* Bounded concurrency: the doc-gateway parses under its own scan/digital lanes and answers
     * 503 when saturated — hammering it would just convert into skipped files. */
    const withLimit = createConcurrencyLimiter(concurrency);
    await Promise.all(
      targets.map((file) =>
        withLimit(async () => {
          const docMetadata = await fetchDocMetadata({ appConfig, file });
          if (!docMetadata) {
            results.skipped++;
            return;
          }
          await File.updateOne({ file_id: file.file_id }, { $set: { docMetadata } });
          results.extracted++;
          if (results.details.length < DETAIL_SAMPLE_LIMIT) {
            results.details.push({
              file_id: file.file_id,
              filename: file.filename,
              docType: docMetadata.docType,
              parties: docMetadata.parties.length,
            });
          }
        }),
      ),
    );

    results.remaining = await File.countDocuments(selector);
    logger.info('Document Metadata Backfill completed', {
      scanned: results.scanned,
      extracted: results.extracted,
      skipped: results.skipped,
      remaining: results.remaining,
    });

    return results;
  });
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const numArg = (name, fallback) =>
    parseInt(process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]) || fallback;

  backfillDocMetadata({
    dryRun,
    batchSize: numArg('batch-size', 100),
    concurrency: numArg('concurrency', 2),
    limit: numArg('limit', 0),
  })
    .then((result) => {
      console.log(`\n=== ${dryRun ? 'DRY RUN ' : ''}RESULTS ===`);
      console.log(`Files scanned: ${result.scanned}`);
      if (dryRun) {
        console.log(`Files to extract: ${result.remaining}`);
      } else {
        console.log(`Metadata extracted: ${result.extracted}`);
        console.log(`Skipped (no text / busy / failed — re-run to retry): ${result.skipped}`);
        console.log(`Still without metadata: ${result.remaining}`);
      }
      if (result.details.length) {
        console.log('\nSample:');
        console.table(result.details);
      }
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Document Metadata Backfill failed', { error: error.message });
      process.exit(1);
    });
}

module.exports = backfillDocMetadata;
