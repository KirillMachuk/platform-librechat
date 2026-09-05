import { useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
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

const GAP = 4;
const MAX_H = 180;
const FADE = 16;

/**
 * The waiting look, shared by the two places that show it (owner r27, «нужно
 * сделать единый стандарт этого рассуждения»): the header of a reasoning block
 * whose thoughts are still streaming, and the in-flow label that stands in
 * before any content has arrived at all. The user sees ONE word in ONE spot
 * across both, so it is one piece of markup — they used to be two components in
 * two type scales and the handoff looked like the design changing mid-wait.
 */
function WaitingContent({ label }: { label: string }) {
  return (
    <>
      <Brain className={styles.trBrain} aria-hidden="true" />
      {/* No trLabel here: its `color` ties with the global shimmer's
       * `color: transparent` at equal specificity, so which one wins would
       * depend on CSS chunk order (К4 review) — the shimmer class owns the
       * waiting label's color outright. */}
      <span className="thinking-shimmer-active">{label}</span>
    </>
  );
}

/** The standalone waiting label (no block, no chevron — there is nothing to
 *  fold yet). Hidden unless a `.submitting` ancestor is present: that gate is
 *  the one the bare shimmering word carried, and it is what keeps a finished
 *  reply from parking a label on screen forever. */
export function ThinkingWaitLabel({ label }: { label: string }) {
  return (
    <span className={styles.trWait} data-testid="waiting-label">
      <WaitingContent label={label} />
    </span>
  );
}

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
  const paragraphs = useMemo(() => (streaming ? [] : text.split(/\n{2,}/)), [streaming, text]);

  /* Rows are as tall as their text (one or two lines), so the stream's height
   * is measured, not multiplied: the cap and the slide-up follow the real rows. */
  const streamRef = useRef<HTMLDivElement>(null);
  const [rowsH, setRowsH] = useState(0);
  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) {
      setRowsH(0);
      return;
    }
    let sum = 0;
    for (const row of Array.from(stream.children)) {
      sum += (row as HTMLElement).offsetHeight;
    }
    setRowsH(sum);
  }, [sentences]);

  const isOpen = streaming ? true : expanded;
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(isOpen);

  const count = sentences.length;
  const contentH = count > 0 ? rowsH + (count - 1) * GAP : 0;
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
        {/* The brain leads from the first moment (owner r27): the waiting label
         * before this block, this header while the thoughts stream and this
         * header once they are folded are one thing to the reader, so the icon
         * is not something the third state introduces. It supersedes the round
         * 24 rule that kept the waiting word bare so its first character would
         * sit where the reply's first token paints — that seam was invisible
         * and cost a visible one (§6.12). The chevron is the exception and
         * stays gated: it is a control, and while streaming there is nothing
         * to fold — a glyph that promises an action it cannot do is the same
         * complaint as the ⏎ hint (r26). */}
        {streaming ? (
          <WaitingContent label={shimmerLabel} />
        ) : (
          <>
            <Brain className={styles.trBrain} aria-hidden="true" />
            <span className={styles.trLabel}>
              <span className={styles.trVerb}>{doneVerb}</span>
              {doneSuffix != null && <> {doneSuffix}</>}
            </span>
            <ChevronDown className={styles.trChevron} aria-hidden="true" />
          </>
        )}
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
              <div
                ref={streamRef}
                className={styles.trStream}
                style={{ transform: `translateY(${translate}px)` }}
              >
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
              <div className={styles.trFull} data-testid="think-full">
                {paragraphs.map((paragraph, i) => (
                  <p key={i} className={styles.trPara}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ThinkingReasoning;
