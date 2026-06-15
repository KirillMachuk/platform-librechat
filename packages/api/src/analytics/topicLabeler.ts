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
        try {
          const raw = await deps.generateLabel({ keywords: topic.keywords });
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
