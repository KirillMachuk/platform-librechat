import { logger } from '@librechat/data-schemas';
import type { ClusterResult } from './topicClusterer';

type Topic = ClusterResult['topics'][number];

export interface TopicLabelerDeps {
  /**
   * Produces a short human-readable theme name from a topic's distinctive
   * keywords, or null when labeling is unavailable. The implementation routes
   * through the anonymizer (mask before egress) → a cheap LLM, so only masked
   * text leaves the perimeter. MUST NOT throw for one topic to fail the batch —
   * the labeler already isolates failures, but keep it defensive.
   */
  generateLabel: (input: { keywords: string[] }) => Promise<string | null>;
  /** Bounds concurrent label calls so a run doesn't fan out dozens at once. Default 3. */
  concurrency?: number;
}

/** Trims, unquotes and length-caps a raw LLM label. */
function cleanLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^["'«»\s]+|["'«»\s.]+$/g, '')
    .slice(0, 80)
    .trim();
}

const EMAIL_RE = /\S+@\S+/;
const URL_RE = /(https?:\/\/|www\.)/i;
const DIGIT_RUN_RE = /\d{6,}/;

/**
 * Defense-in-depth: would this keyword leak STRUCTURED PII if sent for labeling?
 * Catches the patterns a regex can catch with near-zero false positives — emails,
 * URLs, phone/card/passport/account numbers. NAME-type PII is out of scope here and
 * is handled by the labeling endpoint, which routes through the anonymizer (mask
 * before egress). This filter just guarantees obvious identifiers never reach it.
 */
function looksLikePii(keyword: string): boolean {
  if (EMAIL_RE.test(keyword) || URL_RE.test(keyword) || DIGIT_RUN_RE.test(keyword)) {
    return true;
  }
  // Phone numbers often carry separators (+7 999 123-45-67) that defeat the run test.
  return keyword.replace(/\D+/g, '').length >= 7;
}

/** Drops keywords that look like structured PII before they're used as label fodder. */
export function stripPiiKeywords(keywords: string[]): string[] {
  return keywords.filter((k) => !looksLikePii(k));
}

export function createTopicLabeler(deps: TopicLabelerDeps) {
  const concurrency = Math.max(1, deps.concurrency ?? 3);

  /**
   * Returns the topics with a `label` filled in where the LLM produced one.
   * Best-effort: a topic whose label call fails (or returns empty) keeps its
   * keyword-only form. Never throws — labeling must not break a clustering run.
   */
  async function labelTopics(topics: Topic[]): Promise<Topic[]> {
    const result = topics.slice();
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < result.length) {
        const index = cursor++;
        const topic = result[index];
        if (!topic.keywords?.length) {
          continue;
        }
        // Strip structured-PII keywords before egress; if nothing safe remains,
        // keep the topic keyword-only rather than send identifiers off-perimeter.
        const safeKeywords = stripPiiKeywords(topic.keywords);
        if (!safeKeywords.length) {
          logger.debug(
            `[topics] topic ${topic.topicKey}: all keywords filtered as PII — skipping label`,
          );
          continue;
        }
        try {
          const raw = await deps.generateLabel({ keywords: safeKeywords });
          const label = raw ? cleanLabel(raw) : '';
          if (label) {
            result[index] = { ...topic, label };
          }
        } catch (error) {
          logger.warn(`[topics] labeling topic ${topic.topicKey} failed:`, error);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, result.length) }, () => worker()));
    return result;
  }

  return { labelTopics };
}

export type TopicLabeler = ReturnType<typeof createTopicLabeler>;
