import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleArrowRight,
  CornerDownLeft,
  ListChecks,
  ListTodo,
  MessageCircleQuestion,
  Terminal,
  X,
} from '~/components/icons';
import styles from './ApprovalCard.module.css';

/**
 * Vendored from aicss.dev approval-card (github.com/kvnkld/aicss, MIT,
 * registry snapshot 2026-08-25). Design and mechanics are the original's
 * (vertical question carousel with 320ms auto-advance, «Something else»
 * free-text row, rolling-digit pager, plan to-do well with grid-rows
 * collapse, auto-approve pie with hover-to-cancel). Adaptation per
 * DESIGN_SYSTEM.md §6.17 and the owner's decisions:
 * - lucide → Tabler icons; demo defaults, «use client» and the dead
 *   Download button removed; Maximize replaced by a caller-provided
 *   `headerAction` slot (К2 puts the cancel ✕ there);
 * - every visible string comes through the required `strings` prop
 *   (localization lives at the call site);
 * - the auto-approve pie is CONTROLLED: the parent owns the clock and
 *   passes {secsLeft, total} (null cancels with the original fade);
 * - reject/onReject renamed to secondary/onSecondary — the ghost button
 *   is not always a rejection (К2 wires «Редактировать» into it).
 */

export type ApprovalVariant = 'questions' | 'command' | 'plan';

export interface ApprovalQuestion {
  id: string;
  prompt: string;
  options: string[];
}

export interface ApprovalPlanStep {
  id: string;
  title: string;
  /** Live status while a plan RUNS (r25 package Б): the dashed circle is the
   *  plan's own resting state, the arrow marks the step being worked on (its
   *  label carries the platform shimmer), the check marks a finished one. */
  status?: 'pending' | 'active' | 'done';
}

export interface ApprovalCardStrings {
  /** Visible */
  otherPlaceholder: string;
  moreLabel: (hidden: number) => string;
  lessLabel: string;
  /** «Auto Approve in {digits}s» — parts around the rolling digits */
  autoApproveBefore: string;
  autoApproveAfter: string;
  autoApproveCancelTip?: string;
  /** Aria */
  prevQuestion: string;
  nextQuestion: string;
  cancelAutoApprove: string;
  questionOf: (current: number, total: number) => string;
  customAnswerFor: (prompt: string) => string;
}

const ADVANCE_MS = 320;
/** Arrow keys inside a radio group move the focus; both axes, as ARIA asks. */
/** Up/Down only — inside a text field Left/Right belong to the caret. */
const VERTICAL_DELTA: Record<string, number | undefined> = {
  ArrowDown: 1,
  ArrowUp: -1,
};
const ARROW_DELTA: Record<string, number | undefined> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};
const ROLL_MS = 400;

function RollingDigits({ value }: { value: string }) {
  const prevRef = useRef(value);
  const [oldVal, setOldVal] = useState(value);
  const [newVal, setNewVal] = useState(value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [dir, setDir] = useState<'up' | 'down'>('up');

  useEffect(() => {
    if (prevRef.current === value) {
      return;
    }
    const from = prevRef.current;
    prevRef.current = value;
    const fromN = parseInt(from, 10);
    const toN = parseInt(value, 10);
    setDir(Number.isFinite(fromN) && Number.isFinite(toN) && toN < fromN ? 'down' : 'up');
    setOldVal(from);
    setNewVal(value);
    setRolling(true);
    setShifted(false);

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShifted(true));
    });
    const done = setTimeout(() => {
      setRolling(false);
      setOldVal(value);
      setShifted(false);
    }, ROLL_MS);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(done);
    };
  }, [value]);

  const chars = rolling ? newVal : oldVal;

  return (
    <>
      {Array.from({ length: chars.length }, (_, i) => {
        const o = oldVal[i] ?? '';
        const n = chars[i] ?? '';
        if (!rolling || o === n) {
          return (
            <span key={`${i}-${n}`} className={styles.digitStatic}>
              {n}
            </span>
          );
        }
        const top = dir === 'down' ? n : o;
        const bottom = dir === 'down' ? o : n;
        return (
          <span key={`${i}-${o}-${n}-${dir}`} className={styles.digitRoll}>
            <span
              className={styles.digitRollInner}
              data-dir={dir}
              data-shifted={shifted ? 'true' : undefined}
            >
              <span>{top}</span>
              <span>{bottom}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

function TodoStatusIcon({ status }: { status?: ApprovalPlanStep['status'] }) {
  if (status === 'done') {
    return <Check className={styles.todoIcon} aria-hidden />;
  }
  if (status === 'active') {
    return <CircleArrowRight className={styles.todoIcon} aria-hidden />;
  }
  return <TodoDashedIcon />;
}

function TodoDashedIcon() {
  const dots = 12;
  const dash = 0.022;
  const gap = 1 / dots - dash;
  return (
    <svg className={styles.todoIcon} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        pathLength={1}
        strokeDasharray={`${dash} ${gap}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Header icon button in the original's headAction style — К2 passes the
 *  cancel ✕ through `headerAction` wrapped in this. */
export function ApprovalCardHeaderAction({
  label,
  onClick,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.headAction} tap-target`}
      aria-label={label}
      data-testid={testId}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children ?? <X className={styles.headActionIcon} aria-hidden />}
    </button>
  );
}

export interface ApprovalCardProps {
  variant: ApprovalVariant;
  strings: ApprovalCardStrings;
  title: string;
  /** Absent on a card that shows no actions (the running research card). */
  approveLabel?: string;
  secondaryLabel?: string;
  questions?: ApprovalQuestion[];
  command?: string;
  cwd?: string;
  plan?: ApprovalPlanStep[];
  planTitle?: string;
  planSummary?: string;
  /** Label of the to-do well head (the original's «To-dos»). */
  todoTitle?: string;
  planPreviewCount?: number;
  /** CONTROLLED auto-approve pie (plan variant): the parent owns the clock
   *  and the firing (PlanCard's wall-clock countdown survived a series of
   *  shipped bugs — background-tab throttling, F5 resume, refusal disarm —
   *  and must stay the only timer). The card only draws: pass
   *  {secsLeft, total} while counting, null/absent when there is no timer;
   *  a transition to null plays the original fade-out. */
  autoApprove?: { secsLeft: number; total: number } | null;
  /** The ✕ on the pie; the parent cancels its own countdown here. */
  onAutoApproveCancel?: () => void;
  /** Hint line under the actions (edit hint, autostart-cancelled note). */
  footnote?: React.ReactNode;
  /** False renders the card statically: no action row, no pie (an answered
   *  plan card keeps its content but stops being a control). */
  showActions?: boolean;
  /** False keeps the option rows LIVE but disarms every commit path —
   *  «Продолжить»/«Пропустить», the card-level Enter, the free-text
   *  auto-approve. The ask_user card arms them only once the model's turn
   *  ends (r25: answers are selectable while the tail text still streams). */
  actionsArmed?: boolean;
  /** Seeds the answers across the finalization remount (the part key carries
   *  messageId — the reasoningExpandedInitial survival pattern). A seeded
   *  answer outside the question's options re-selects «Другое…» with it. */
  initialAnswers?: Record<string, string>;
  /** Reports every answers change upward (a ref write in the parent). */
  onAnswersChange?: (answers: Record<string, string>) => void;
  /** Extra header button(s), rendered where the original had Download/
   *  Maximize. Use ApprovalCardHeaderAction. */
  headerAction?: React.ReactNode;
  onApprove?: (payload?: { answers?: Record<string, string> }) => void;
  onSecondary?: () => void;
  /** aria-pressed on the ghost button (PlanCard's «Редактировать» mode). */
  secondaryPressed?: boolean;
  className?: string;
}

export function ApprovalCard({
  variant,
  strings,
  title,
  approveLabel,
  secondaryLabel,
  questions = [],
  command = '',
  cwd = '',
  plan = [],
  planTitle,
  planSummary,
  todoTitle,
  planPreviewCount = 3,
  autoApprove,
  onAutoApproveCancel,
  footnote,
  showActions = true,
  actionsArmed = true,
  initialAnswers,
  onAnswersChange,
  headerAction,
  onApprove,
  onSecondary,
  secondaryPressed,
  className,
}: ApprovalCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => initialAnswers ?? {});
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>(() => {
    const seeded: Record<string, boolean> = {};
    for (const q of questions) {
      const a = initialAnswers?.[q.id];
      if (a != null && !q.options.includes(a)) {
        seeded[q.id] = true;
      }
    }
    return seeded;
  });
  const [customDraft, setCustomDraft] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const q of questions) {
      const a = initialAnswers?.[q.id];
      if (a != null && !q.options.includes(a)) {
        seeded[q.id] = a;
      }
    }
    return seeded;
  });
  const [step, setStep] = useState(0);
  /* Tri-state: null = nobody has decided, so the card decides (a running step
   * in the hidden rest force-opens the well). An explicit click always wins —
   * with a plain boolean the toggle went dead during a run: it flipped its own
   * caption while auto-expand kept the rows open (r25 package Б review). */
  const [planExpanded, setPlanExpanded] = useState<boolean | null>(null);
  const autoApproveActive = variant === 'plan' && autoApprove != null && autoApprove.secsLeft > 0;
  /* The fade-out keeps showing the LAST ticking frame (the original froze
   * the pie too instead of snapping to zero). */
  const lastAutoRef = useRef(autoApprove ?? null);
  if (autoApprove != null) {
    lastAutoRef.current = autoApprove;
  }
  const shownAuto = autoApprove ?? lastAutoRef.current;
  const [autoUI, setAutoUI] = useState<'active' | 'leaving' | 'gone'>(
    autoApproveActive ? 'active' : 'gone',
  );
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const customInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const qMeasured = useRef(false);
  const [qViewportH, setQViewportH] = useState<number | undefined>(undefined);
  const [qTrackY, setQTrackY] = useState(0);
  const [qAnimate, setQAnimate] = useState(false);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) {
        clearTimeout(advanceTimer.current);
      }
      if (autoFadeTimer.current) {
        clearTimeout(autoFadeTimer.current);
      }
    };
  }, []);

  const safeStep = Math.min(step, Math.max(questions.length - 1, 0));
  /** Which option in a question owns the group's single tab stop: the chosen
   *  one, or the first when nothing is chosen yet (ARIA radio-group rule). */
  const rovingIndex = (q: ApprovalQuestion): number => {
    /* -1 when the answer is free text: the «Другое…» input owns the group's
     * tab stop then, and leaving one on an option made two (r25c review). */
    if (isOtherChoice(q)) {
      return -1;
    }
    const chosen = q.options.indexOf(answers[q.id] ?? '');
    return chosen >= 0 ? chosen : 0;
  };
  const allAnswered =
    questions.length > 0 && questions.every((q) => Boolean(answers[q.id]?.trim()));
  const stepLabel = `${safeStep + 1} / ${questions.length}`;

  const isOtherChoice = (q: ApprovalQuestion) => {
    if (otherSelected[q.id]) {
      return true;
    }
    const a = answers[q.id];
    return Boolean(a) && !q.options.includes(a);
  };

  const syncQuestionSlide = (animate: boolean) => {
    const item = questionRefs.current[safeStep];
    if (!item) {
      return;
    }
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setQViewportH(item.offsetHeight + 2);
    setQTrackY(item.offsetTop);
    setQAnimate(animate && !reduce);
  };

  useLayoutEffect(() => {
    if (variant !== 'questions') {
      qMeasured.current = false;
      setQViewportH(undefined);
      setQTrackY(0);
      setQAnimate(false);
      return;
    }
    const animate = qMeasured.current;
    qMeasured.current = true;
    syncQuestionSlide(animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, safeStep, questions, answers]);

  useEffect(() => {
    if (variant !== 'questions') {
      return;
    }
    const id = requestAnimationFrame(() => syncQuestionSlide(qMeasured.current));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, safeStep, questions]);

  /* Adaptation over the original: the carousel viewport height and track
   * offset are MEASURED, and the original only re-measured on step change.
   * A font load, a container resize, or a theme swap after mount left the
   * viewport at a stale height (seen live on the acceptance page). Watch the
   * active question and re-sync without animation. */
  useEffect(() => {
    if (variant !== 'questions' || typeof ResizeObserver === 'undefined') {
      return;
    }
    const item = questionRefs.current[safeStep];
    if (!item) {
      return;
    }
    /* observe() always delivers a mandatory initial notification — skip it
     * so the slide animation survives; only real later resizes re-sync. */
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      syncQuestionSlide(false);
    });
    observer.observe(item);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, safeStep, questions]);

  const previewCount = Math.max(0, planPreviewCount);
  const planPreview = plan.slice(0, previewCount);
  const planRest = plan.slice(previewCount);
  const hasPlanMore = planRest.length > 0;
  /* A step being worked on must never sit inside the collapsed well — the card
   * would show a frozen preview while the run moved on (r25 package Б). */
  const activeHidden = planRest.some((stepItem) => stepItem.status === 'active');
  const showPlanRest = planExpanded ?? (activeHidden || !hasPlanMore);

  const canContinue = variant !== 'questions' || allAnswered;

  useEffect(() => {
    onAnswersChange?.(answers);
  }, [answers, onAnswersChange]);

  const handleApprove = (nextAnswers?: Record<string, string>) => {
    if (!actionsArmed) {
      return;
    }
    if (variant === 'questions') {
      const a = nextAnswers ?? answers;
      const ok = questions.every((q) => Boolean(a[q.id]?.trim()));
      if (!ok) {
        return;
      }
      onApprove?.({ answers: a });
      return;
    }
    onApprove?.();
  };

  /* Controlled fade: while the parent supplies ticking seconds the pie is
   * live; when the parent drops the countdown (cancel by ✕/edit/typing, or
   * expiry without unmount) the block fades out like the original's ✕. */
  useEffect(() => {
    if (autoApproveActive) {
      if (autoUI !== 'active') {
        if (autoFadeTimer.current) {
          clearTimeout(autoFadeTimer.current);
        }
        setAutoUI('active');
      }
      return;
    }
    if (autoUI === 'active') {
      setAutoUI('leaving');
      if (autoFadeTimer.current) {
        clearTimeout(autoFadeTimer.current);
      }
      autoFadeTimer.current = setTimeout(() => setAutoUI('gone'), 280);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApproveActive]);

  const selectOption = (questionId: string, opt: string) => {
    setOtherSelected((prev) => ({ ...prev, [questionId]: false }));
    setAnswers((prev) => ({ ...prev, [questionId]: opt }));
    if (safeStep < questions.length - 1) {
      if (advanceTimer.current) {
        clearTimeout(advanceTimer.current);
      }
      advanceTimer.current = setTimeout(() => {
        setStep((s) => Math.min(s + 1, questions.length - 1));
      }, ADVANCE_MS);
    }
  };

  const selectOther = (questionId: string) => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
    }
    setOtherSelected((prev) => ({ ...prev, [questionId]: true }));
    const draft = customDraft[questionId]?.trim() ?? '';
    setAnswers((prev) => {
      const next = { ...prev };
      if (draft) {
        next[questionId] = draft;
      } else {
        delete next[questionId];
      }
      return next;
    });
    requestAnimationFrame(() => {
      customInputRefs.current[questionId]?.focus();
    });
  };

  const updateCustom = (questionId: string, text: string) => {
    setCustomDraft((prev) => ({ ...prev, [questionId]: text }));
    setOtherSelected((prev) => ({ ...prev, [questionId]: true }));
    setAnswers((prev) => {
      const next = { ...prev };
      const trimmed = text.trim();
      if (trimmed) {
        next[questionId] = trimmed;
      } else {
        delete next[questionId];
      }
      return next;
    });
  };

  const commitCustom = (questionId: string, raw?: string) => {
    const text = (raw ?? customDraft[questionId] ?? answers[questionId] ?? '').trim();
    if (!text) {
      return;
    }
    setCustomDraft((prev) => ({
      ...prev,
      [questionId]: raw ?? prev[questionId] ?? text,
    }));
    setOtherSelected((prev) => ({ ...prev, [questionId]: true }));
    const nextAnswers = { ...answers, [questionId]: text };
    setAnswers(nextAnswers);
    if (safeStep < questions.length - 1) {
      if (advanceTimer.current) {
        clearTimeout(advanceTimer.current);
      }
      setStep((s) => Math.min(s + 1, questions.length - 1));
      return;
    }
    handleApprove(nextAnswers);
  };

  const goToStep = (next: number) => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
    }
    setStep(Math.min(Math.max(next, 0), questions.length - 1));
  };

  const VARIANT_ICONS = {
    questions: MessageCircleQuestion,
    command: Terminal,
    plan: ListTodo,
  } as const;
  const Icon = VARIANT_ICONS[variant];

  return (
    <div
      className={`${styles.card}${className ? ` ${className}` : ''}`}
      data-variant={variant}
      data-static={showActions ? undefined : 'true'}
      data-testid="approval-card"
      onKeyDown={(e) => {
        if (e.key !== 'Enter') {
          return;
        }
        if (variant !== 'questions') {
          return;
        }
        if (safeStep !== questions.length - 1 || !canContinue) {
          return;
        }
        /* Enter approves only from a NON-interactive spot: pressing Enter on
         * a focused radio, pager arrow, input or button must activate that
         * control, not submit the card with the pre-change answers (xhigh
         * review: the original exempted only the two footer buttons). */
        const el = e.target as HTMLElement;
        if (el.closest('button, input, textarea, a, [role="radio"]')) {
          return;
        }
        e.preventDefault();
        handleApprove();
      }}
    >
      <div className={styles.head}>
        <span className={styles.icon} data-variant={variant}>
          <Icon className={styles.iconSvg} aria-hidden />
        </span>
        <div className={styles.headText}>
          <h3 className={styles.title}>{title}</h3>
        </div>
        {headerAction != null && <div className={styles.headActions}>{headerAction}</div>}
      </div>

      {variant === 'questions' && questions.length > 0 && (
        <div
          className={styles.questionsViewport}
          style={qViewportH != null ? { height: qViewportH } : undefined}
          data-animate={qAnimate ? 'true' : undefined}
          aria-live="polite"
        >
          <div
            className={styles.questionsTrack}
            style={{ transform: `translate3d(0, ${-qTrackY}px, 0)` }}
            data-animate={qAnimate ? 'true' : undefined}
          >
            {questions.map((q, qi) => {
              const active = qi === safeStep;
              return (
                <div
                  key={q.id}
                  ref={(el) => {
                    questionRefs.current[qi] = el;
                  }}
                  className={styles.question}
                  data-active={active ? 'true' : undefined}
                  aria-hidden={active ? undefined : true}
                >
                  <div className={styles.qPrompt}>{q.prompt}</div>
                  <div className={styles.options} role="radiogroup" aria-label={q.prompt}>
                    {q.options.map((opt, oi) => {
                      const selected = answers[q.id] === opt && !isOtherChoice(q);
                      const letter = String.fromCharCode(65 + oi);
                      return (
                        <button
                          key={`${q.id}-${oi}`}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          ref={(el) => {
                            optionRefs.current[`${q.id}-${oi}`] = el;
                          }}
                          /* Roving tabindex, as a radio group is supposed to
                           * behave: Tab reaches the group once and lands on
                           * the selected option (or the first), the arrows
                           * move within it. Before this every option was a
                           * tab stop and the arrows did nothing — announced
                           * as a radio group, behaving like a button list
                           * (r25 acceptance). Deliberate deviation from APG:
                           * arrows MOVE focus without selecting, because
                           * selecting auto-advances the carousel after 320ms
                           * and navigation would become impossible. */
                          tabIndex={active && oi === rovingIndex(q) ? 0 : -1}
                          className={styles.option}
                          data-selected={selected ? 'true' : undefined}
                          onKeyDown={(e) => {
                            if (!active) {
                              return;
                            }
                            const delta = ARROW_DELTA[e.key];
                            if (delta == null) {
                              return;
                            }
                            e.preventDefault();
                            e.stopPropagation();
                            const total = q.options.length + 1;
                            const next = (oi + delta + total) % total;
                            if (next === q.options.length) {
                              customInputRefs.current[q.id]?.focus();
                              return;
                            }
                            optionRefs.current[`${q.id}-${next}`]?.focus();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            if (!active) {
                              return;
                            }
                            selectOption(q.id, opt);
                          }}
                        >
                          <span className={styles.key} aria-hidden>
                            {letter}
                          </span>
                          {opt}
                        </button>
                      );
                    })}
                    {(() => {
                      const otherLetter = String.fromCharCode(65 + q.options.length);
                      const otherOn = isOtherChoice(q);
                      const draft =
                        customDraft[q.id] ??
                        (otherOn && answers[q.id] && !q.options.includes(answers[q.id])
                          ? answers[q.id]
                          : '');
                      return (
                        <div
                          className={styles.option}
                          data-selected={otherOn ? 'true' : undefined}
                          data-other="true"
                          onClick={(e) => {
                            e.preventDefault();
                            if (!active) {
                              return;
                            }
                            selectOther(q.id);
                          }}
                        >
                          <span className={styles.key} aria-hidden>
                            {otherLetter}
                          </span>
                          <input
                            ref={(el) => {
                              customInputRefs.current[q.id] = el;
                            }}
                            className={styles.optionInput}
                            type="text"
                            value={draft}
                            placeholder={strings.otherPlaceholder}
                            tabIndex={
                              active && (isOtherChoice(q) || q.options.length === 0) ? 0 : -1
                            }
                            aria-label={strings.customAnswerFor(q.prompt)}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!active) {
                                return;
                              }
                              selectOther(q.id);
                            }}
                            onChange={(e) => {
                              if (!active) {
                                return;
                              }
                              updateCustom(q.id, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (!active) {
                                return;
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitCustom(q.id, e.currentTarget.value);
                                return;
                              }
                              /* The ring closes both ways: arrows walk out of
                               * the free-text row back into the options. Up/Down
                               * only — Left/Right belong to the caret here. */
                              const delta = VERTICAL_DELTA[e.key];
                              if (delta == null) {
                                return;
                              }
                              e.preventDefault();
                              const total = q.options.length + 1;
                              const next = (q.options.length + delta + total) % total;
                              optionRefs.current[`${q.id}-${next}`]?.focus();
                            }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {variant === 'command' && (
        <div className={styles.cmdBlock}>
          <div className={styles.cwd}>{cwd}</div>
          <pre className={styles.cmd}>{command}</pre>
        </div>
      )}

      {variant === 'plan' && (
        <>
          {(planTitle != null || planSummary != null) && (
            <div className={styles.planIntro}>
              {planTitle != null && <div className={styles.planHeadline}>{planTitle}</div>}
              {planSummary != null && <div className={styles.planSummary}>{planSummary}</div>}
            </div>
          )}
          {plan.length > 0 && (
            <div className={styles.todoWell}>
              <div className={styles.todoHead}>
                <span className={styles.todoHeadIcon}>
                  <ListChecks className={styles.todoListIcon} aria-hidden />
                </span>
                <span className={styles.todoTitle}>{todoTitle}</span>
                <span className={styles.todoCount}>{plan.length}</span>
              </div>
              <ul className={styles.todoList}>
                {planPreview.map((stepItem) => (
                  <li
                    key={stepItem.id}
                    className={styles.todoItem}
                    data-status={stepItem.status}
                    aria-current={stepItem.status === 'active' ? 'step' : undefined}
                  >
                    <span className={styles.todoIconWrap}>
                      <TodoStatusIcon status={stepItem.status} />
                    </span>
                    <span
                      className={
                        stepItem.status === 'active'
                          ? `${styles.todoLabel} thinking-shimmer-paint`
                          : styles.todoLabel
                      }
                    >
                      {stepItem.title}
                    </span>
                  </li>
                ))}
              </ul>
              {hasPlanMore && (
                <>
                  <div
                    className={`${styles.todoCollapsible}${showPlanRest ? '' : ` ${styles.todoCollapsed}`}`}
                  >
                    <div className={styles.todoInner}>
                      <div className={styles.todoRest}>
                        <ul className={`${styles.todoList} ${styles.todoListFlush}`}>
                          {planRest.map((stepItem) => (
                            <li
                              key={stepItem.id}
                              className={styles.todoItem}
                              data-status={stepItem.status}
                              aria-current={stepItem.status === 'active' ? 'step' : undefined}
                            >
                              <span className={styles.todoIconWrap}>
                                <TodoStatusIcon status={stepItem.status} />
                              </span>
                              <span
                                className={
                                  stepItem.status === 'active'
                                    ? `${styles.todoLabel} thinking-shimmer-paint`
                                    : styles.todoLabel
                                }
                              >
                                {stepItem.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.todoMore}
                    /* What is SHOWN, not what the user last clicked: a running
                     * step force-opens the well (r25 package Б), and reporting
                     * the stale user flag would announce «collapsed» over
                     * visible rows. */
                    aria-expanded={showPlanRest}
                    onClick={(e) => {
                      e.preventDefault();
                      setPlanExpanded(!showPlanRest);
                    }}
                  >
                    <span className={styles.todoMoreIcon} aria-hidden>
                      <svg className={styles.todoMoreGlyph} viewBox="0 0 24 24" aria-hidden>
                        {showPlanRest ? (
                          <rect
                            x="4.75"
                            y="11.25"
                            width="14.5"
                            height="1.5"
                            rx="0.75"
                            fill="currentColor"
                          />
                        ) : (
                          <>
                            <circle cx="6" cy="12" r="1.25" fill="currentColor" />
                            <circle cx="12" cy="12" r="1.25" fill="currentColor" />
                            <circle cx="18" cy="12" r="1.25" fill="currentColor" />
                          </>
                        )}
                      </svg>
                    </span>
                    {showPlanRest ? strings.lessLabel : strings.moreLabel(planRest.length)}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {(showActions || variant === 'questions') && (
        <div className={styles.actions}>
          {variant === 'questions' && questions.length > 1 && (
            <div
              className={styles.stepNav}
              aria-label={strings.questionOf(safeStep + 1, questions.length)}
            >
              <button
                type="button"
                className={`${styles.stepArrow} tap-target`}
                aria-label={strings.prevQuestion}
                disabled={safeStep <= 0}
                onClick={(e) => {
                  e.preventDefault();
                  goToStep(safeStep - 1);
                }}
              >
                <ChevronUp className={styles.stepArrowIcon} aria-hidden />
              </button>
              <span className={styles.stepBadge} aria-live="polite">
                <RollingDigits value={stepLabel} />
              </span>
              <button
                type="button"
                className={`${styles.stepArrow} tap-target`}
                aria-label={strings.nextQuestion}
                disabled={safeStep >= questions.length - 1}
                onClick={(e) => {
                  e.preventDefault();
                  goToStep(safeStep + 1);
                }}
              >
                <ChevronDown className={styles.stepArrowIcon} aria-hidden />
              </button>
            </div>
          )}
          {variant === 'plan' && autoUI !== 'gone' && (
            <div
              className={`${styles.autoApprove}${autoUI === 'leaving' ? ` ${styles.autoApproveOut}` : ''}`}
              data-testid="auto-approve"
            >
              <span
                className={styles.autoApproveTip}
                data-tip={strings.autoApproveCancelTip ?? undefined}
              >
                <button
                  type="button"
                  className={`${styles.autoApproveCancel} tap-target`}
                  aria-label={strings.cancelAutoApprove}
                  disabled={autoUI !== 'active'}
                  onClick={(e) => {
                    e.preventDefault();
                    onAutoApproveCancel?.();
                  }}
                >
                  <svg
                    className={styles.autoApprovePie}
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    aria-hidden
                  >
                    <circle
                      className={styles.autoApprovePieTrack}
                      cx="12"
                      cy="12"
                      r="9"
                      fill="none"
                      strokeWidth="1.8"
                    />
                    <circle
                      className={styles.autoApprovePieFill}
                      cx="12"
                      cy="12"
                      r="9"
                      fill="none"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      pathLength={1}
                      strokeDasharray={1}
                      style={{
                        strokeDashoffset:
                          shownAuto != null && shownAuto.total > 0
                            ? 1 - (shownAuto.total - shownAuto.secsLeft) / shownAuto.total
                            : 1,
                      }}
                      transform="rotate(-90 12 12)"
                    />
                  </svg>
                  <span className={styles.autoApproveCancelGlyph} aria-hidden>
                    <X size={8} stroke={2.5} />
                  </span>
                </button>
              </span>
              <span className={styles.autoApproveLabel}>
                {strings.autoApproveBefore}
                <span className={styles.autoApproveSecs}>
                  <RollingDigits value={String(shownAuto?.secsLeft ?? 0)} />
                </span>
                {strings.autoApproveAfter}
              </span>
            </div>
          )}
          {showActions && variant !== 'questions' && !(variant === 'plan' && autoUI !== 'gone') && (
            <span className={styles.actionsSpacer} aria-hidden />
          )}
          <div className={styles.actionBtns}>
            {showActions && secondaryLabel != null && (
              <button
                type="button"
                className={`${styles.btnGhost} tap-target`}
                aria-pressed={secondaryPressed}
                disabled={!actionsArmed}
                onClick={(e) => {
                  e.preventDefault();
                  onSecondary?.();
                }}
              >
                {secondaryLabel}
              </button>
            )}
            {showActions && (
              <button
                type="button"
                className={`${styles.btnPrimary} tap-target`}
                disabled={!canContinue || !actionsArmed}
                onClick={(e) => {
                  e.preventDefault();
                  handleApprove();
                }}
              >
                {approveLabel}
                {variant === 'questions' && (
                  <CornerDownLeft className={styles.btnSubmitIcon} size={12} aria-hidden />
                )}
              </button>
            )}
          </div>
        </div>
      )}
      {footnote}
    </div>
  );
}

export default ApprovalCard;
