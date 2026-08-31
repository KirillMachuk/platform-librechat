import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { MouseEvent } from 'react';
import { Brain, ChevronDown } from '~/components/icons';
import styles from './ThinkingReasoning.module.css';
import { splitThinkSentences } from '~/utils';
import { useExpandCollapse } from '~/hooks';

/**
 * Vendored from aicss.dev thinking-reasoning (MIT, snapshot 2026-08-25) and
 * rewired from the original's demo timers to real streaming data (cards К4,
 * DESIGN_SYSTEM.md §6.17). Presentation only — the Reasoning part owns the
 * data, the label texts and the expansion state.
 *
 * Two phases, exactly the original's:
 *  - streaming: forced open, sentences fade in as chunks arrive, each row
 *    clamped to 2 lines; the viewport grows to MAX_H, then the stream
 *    auto-scrolls behind soft fade masks;
 *  - done: folds into the summary line; reopened it shows the FULL text
 *    (plan К4 override: the clamp lives only in the live preview) inside a
 *    natively scrollable viewport whose fades follow the scroll position.
 */

const SENT_H = 40;
const GAP = 4;
const MAX_H = 180;
const FADE = 16;

type ThinkingReasoningProps = {
  text: string;
  streaming: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Header while streaming — carries the platform shimmer (§6.12). */
  shimmerLabel: string;
  /** Header verb when finished: «Думал» with a duration, «Мысли» without. */
  doneVerb: string;
  /** The soft «N с» half of the finished header; absent → verb only. */
  doneSuffix?: string;
  ariaLabel: string;
  contentId: string;
};

export function ThinkingReasoning({
  text,
  streaming,
  expanded,
  onToggle,
  shimmerLabel,
  doneVerb,
  doneSuffix,
  ariaLabel,
  contentId,
}: ThinkingReasoningProps) {
  const staticMount = useRef(!streaming);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  const sentences = useMemo(() => (streaming ? splitThinkSentences(text) : []), [streaming, text]);

  const isOpen = streaming ? true : expanded;
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isOpen);

  const count = sentences.length;
  const contentH = count > 0 ? count * SENT_H + (count - 1) * GAP : 0;
  const capped = contentH > MAX_H;
  const viewH = capped ? MAX_H : contentH;
  const translate = capped ? MAX_H - FADE - contentH : 0;

  const streamMask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${FADE}px, #000 calc(100% - ${FADE}px), transparent 100%)`
    : undefined;
  const scrollMask =
    fade.top || fade.bottom
      ? `linear-gradient(to bottom, transparent 0, #000 ${fade.top ? FADE : 0}px, #000 calc(100% - ${fade.bottom ? FADE : 0}px), transparent 100%)`
      : undefined;

  const syncScrollFades = useCallback(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    if (!streaming && isOpen) {
      syncScrollFades();
    }
  }, [streaming, isOpen, syncScrollFades]);

  const handleToggle = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (streaming) {
        return;
      }
      if (!expanded && viewportRef.current) {
        viewportRef.current.scrollTop = 0;
      }
      onToggle();
    },
    [streaming, expanded, onToggle],
  );

  return (
    <div
      className={styles.tr}
      data-testid="thinking-block"
      data-static={staticMount.current ? 'true' : undefined}
    >
      <button
        type="button"
        className={streaming ? styles.trHeader : `${styles.trHeader} ${styles.isClickable}`}
        aria-expanded={isOpen}
        aria-disabled={streaming || undefined}
        aria-controls={contentId}
        aria-label={ariaLabel}
        onClick={handleToggle}
      >
        <Brain className={styles.trBrain} aria-hidden="true" />
        {streaming ? (
          /* No trLabel here: its `color` ties with the global shimmer's
           * `color: transparent` at equal specificity, so which one wins
           * would depend on CSS chunk order (К4 review) — the shimmer class
           * owns the streaming label's color outright. */
          <span className="thinking-shimmer-active">{shimmerLabel}</span>
        ) : (
          <span className={styles.trLabel}>
            <span className={styles.trVerb}>{doneVerb}</span>
            {doneSuffix != null && <> {doneSuffix}</>}
          </span>
        )}
        {!streaming && <ChevronDown className={styles.trChevron} aria-hidden="true" />}
      </button>

      <div
        id={contentId}
        role="group"
        aria-label={ariaLabel}
        aria-hidden={!isOpen || undefined}
        style={expandStyle}
      >
        <div className="relative overflow-hidden" ref={expandRef}>
          {streaming ? (
            <div
              className={styles.trViewport}
              style={{
                height: `${viewH}px`,
                WebkitMaskImage: streamMask,
                maskImage: streamMask,
              }}
            >
              <div className={styles.trStream} style={{ transform: `translateY(${translate}px)` }}>
                {sentences.map((line, i) => (
                  <p key={i} className={styles.trSentence} data-testid="think-sentence">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div
              ref={viewportRef}
              className={`${styles.trViewport} ${styles.isScroll}`}
              style={{ WebkitMaskImage: scrollMask, maskImage: scrollMask }}
              onScroll={syncScrollFades}
            >
              <p className={styles.trFull} data-testid="think-full">
                {text}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ThinkingReasoning;
