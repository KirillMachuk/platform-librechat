/**
 * Shared MeiliSearch index configuration for the `messages` index.
 *
 * The admin "AI usage analytics" search (cross-user, tenant-scoped, ranked,
 * typo-tolerant) runs against the SAME `messages` index that powers the
 * per-user chat search. To search across users while staying tenant-isolated
 * it must filter by `tenantId` (never derivable from a Meili query otherwise),
 * restrict to employee requests (`isCreatedByUser`), and scope by period
 * (`createdAtTs`, a numeric epoch so Meili can range-filter it).
 *
 * These constants are the single source of truth for the index settings.
 * They are consumed in TWO places that MUST agree, or the startup sync will
 * narrow the settings back and silently break the analytics filters:
 *   1. the mongoMeili plugin options (packages/data-schemas/src/models/message.ts)
 *   2. api/db/indexSync.js `ensureFilterableAttributes`
 *
 * Adding/removing an attribute here is a settings change that triggers a full
 * Meili re-sync on next boot (indexSync detects the drift and reindexes).
 */

/** Numeric (epoch ms) mirror of `createdAt`, emitted only into the Meili index
 * (not stored in Mongo) so Meili can range-filter and the period filter works. */
export const MEILI_CREATED_AT_TS_FIELD = 'createdAtTs';

/** Filterable attributes required on the `messages` index for analytics search. */
export const MESSAGE_MEILI_FILTERABLE_ATTRIBUTES: string[] = [
  'user',
  'tenantId',
  'isCreatedByUser',
  MEILI_CREATED_AT_TS_FIELD,
];

/**
 * Restrict full-text search to the message body. Without this, the structured
 * filter fields above (tenantId, the numeric timestamp, the boolean flag) would
 * also be searchable and pollute relevance — e.g. a query for "true" matching
 * the `isCreatedByUser` flag. `text` holds user prompts; `content` holds
 * assistant turns whose body lives in the content parts — keeping both
 * preserves the existing per-user search behavior (message bodies stay
 * searchable) while excluding the new metadata fields.
 */
export const MESSAGE_MEILI_SEARCHABLE_ATTRIBUTES: string[] = ['text', 'content'];

/**
 * Sortable attributes. The analytics feed is newest-first; when an admin
 * searches, they expect the same recency ordering (filtered by the term), not
 * pure relevance — otherwise a highly-relevant OLD match buries recent ones and
 * the feature looks like it "can't find recent requests". `createdAtTs` is
 * already in every indexed doc, so enabling sort needs no re-index.
 */
export const MESSAGE_MEILI_SORTABLE_ATTRIBUTES: string[] = [MEILI_CREATED_AT_TS_FIELD];
