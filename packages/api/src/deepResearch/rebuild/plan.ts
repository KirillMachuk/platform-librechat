import { MAX_CLARIFY_QUESTIONS } from './clarify';
import { tolerantJsonParse } from './shared';

/**
 * Plan gate (task #21, ChatGPT-style) — the pre-graph decision that either asks
 * clarifying questions, presents a research PLAN card, or proceeds straight to
 * research. It SUPERSEDES the {@link ./clarify} check ONLY when `deepResearch.planGate`
 * is on; with the flag off the runner keeps calling the untouched clarify path, so
 * this module can never regress the shipped behaviour.
 *
 * The three outcomes map to distinct chat turns, mirroring ChatGPT:
 * - CLARIFY  → the same plain-text questions message the clarify path emits (reused
 *   verbatim, so one marker/format serves detection and old chats). NO card.
 * - PLAN     → a PLAN card message ({@link PLAN_MARKER}); the user starts it with
 *   {@link START_MARKER} (button or autostart), edits it with free text, or cancels
 *   with {@link CANCEL_MARKER}.
 * - PROCEED  → run the graph immediately — the model's EXPLICIT choice when a plan
 *   adds nothing. Ambiguous/garbled output fails CLOSED to PLAN instead (review r2):
 *   the gate's contract is user confirmation before the most expensive action, so a
 *   bad model turn presents a card rather than silently launching a run.
 *
 * NOTE: the marker strings + command detectors here MUST stay identical to the
 * frontend copies in `packages/data-provider/src/deepResearch.ts` (the client renders
 * the card from those). They are duplicated rather than imported because the runner
 * spec must resolve without a data-provider rebuild; both are fixed constants covered
 * by their own tests. Keep the two in sync.
 *
 * The request/dialogue is the user's OWN input (like SCOPE) — passed as a normal
 * message, NOT fenced as untrusted external data — so an explicit "начинай" is honored.
 */

/** Fixed first line of a PLAN card message — how turn 2 detects a plan parent. */
export const PLAN_MARKER = '**План исследования:**';

/** Exact text the "Начать" button / autostart sends as the user's turn-2 message. */
export const START_MARKER = '▶ Начать исследование';

/** Exact text the "Отменить" button sends as the user's turn-2 message. */
export const CANCEL_MARKER = '✕ Отменить исследование';

/** Terminal assistant message after a cancel — carries NO DR marker, so the next
 *  user message routes to normal chat (closes the §7.1 routing hole). */
export const CANCELLED_MESSAGE = 'Исследование отменено.';

/** Max steps rendered on a plan card (guidance is 3–6; the parser only caps the top). */
export const MAX_PLAN_STEPS = 6;

export type PlanAction = 'CLARIFY' | 'PLAN' | 'PROCEED';

export interface PlanDecision {
  action: PlanAction;
  /** Non-empty only for CLARIFY. */
  questions: string[];
  /** Topic title for the card (may be empty → the runner supplies a fallback). */
  title: string;
  /** Ordered plan steps for PLAN (last step describes the deliverable format). */
  steps: string[];
}

/**
 * System prompt for the unified plan/clarify decision. The user request (or the
 * dialogue so far) is provided as a SEPARATE message, as in SCOPE. When
 * `allowClarify` is false (the dialogue already contains a clarify round) the model
 * is told NOT to ask again — the anti-loop the parser also enforces.
 *
 * `isRefinement` (task #21 plan edit): the turn is a comment on an existing plan — a
 * free-text edit on the card, or a comment after a Stop. The dialogue then carries the
 * prior «Предложенный план» + the user's change, and the model is told to return an
 * UPDATED plan that EXPLICITLY reflects that change, not a near-identical one (the live
 * bug: the refinement was ignored, so the re-plan looked "1-в-1").
 */
export function buildPlanPrompt({
  now,
  allowClarify = true,
  isRefinement = false,
}: {
  now: string;
  allowClarify?: boolean;
  isRefinement?: boolean;
}): string {
  const clarifyRule = allowClarify
    ? `- Если для АДРЕСНОЙ рекомендации не хватает критичных вводных (масштаб бизнеса, бюджет, on-prem/облако, отрасль, юрисдикция, ключевые требования) — верни action "CLARIFY" и от 1 до ${MAX_CLARIFY_QUESTIONS} КОРОТКИХ вопросов, только самые важные. Не задавай вопросы ради вопросов.`
    : `- Пользователю уже задавали уточнения (или он просил начинать) — БОЛЬШЕ НЕ УТОЧНЯЙ. Действие "CLARIFY" запрещено; выбирай "PLAN" или "PROCEED". Если пользователь явно просит начать/запустить исследование («начинай», «поехали», «запускай») — верни "PROCEED", не предлагай новый план.`;
  const refinementRule = isRefinement
    ? `\n\nРЕЖИМ ПРАВКИ ПЛАНА: в диалоге есть блок «Предложенный план», а последнее сообщение пользователя — ПРАВКА к нему. Верни action "PLAN" — ОБНОВЛЁННЫЙ план, в котором правка пользователя ЯВНО учтена в шагах (требование по языку, региону, бюджету, источникам или формату вырази отдельным шагом или условием внутри шагов). НЕ повторяй прежний план дословно и НЕ игнорируй правку.`
    : '';
  return `Ты — модуль ПЛАНИРОВАНИЯ системы глубокого исследования (Deep Research) для рынка СНГ.
Дата: ${now}.

Тебе дан запрос пользователя (или диалог уточнения). Реши, что вернуть:
${clarifyRule}
- Иначе верни action "PLAN": короткий ПЛАН исследования из 3–6 шагов. Каждый шаг — сжатая формулировка действия (глагол в инфинитиве). ПОСЛЕДНИЙ шаг ВСЕГДА описывает формат результата (например, «Сформировать сравнительную таблицу и рекомендацию»). Также верни "title" — короткую ТЕМУ исследования в именительном падеже (3–7 слов, это тема, а не команда, без кавычек).
- Если запрос предельно ясен и план не нужен — верни action "PROCEED".${refinementRule}

Язык вопросов, шагов и заголовка = язык запроса пользователя.

Ответь СТРОГО одним JSON-объектом, без markdown и текста вне JSON:
{"action": "CLARIFY|PLAN|PROCEED", "questions": ["<вопрос>"], "title": "<тема>", "steps": ["<шаг 1>", "<шаг 2>"]}`;
}

/** Trims, drops empties, de-duplicates, and caps a string array from model output. */
function cleanStringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

/**
 * Parses the decision. FAIL-CLOSED (review r2): anything unparseable or ambiguous → PLAN,
 * possibly with EMPTY steps — the runner then substitutes a deterministic fallback plan.
 * The gate's contract is explicit user confirmation before the most expensive action in
 * the product, so a garbled model turn must present a card, never silently launch a run.
 * Only an explicit PROCEED proceeds; only an explicit CLARIFY with ≥1 question clarifies.
 * When `allowClarify` is false a CLARIFY result is downgraded to PLAN (anti-loop).
 */
export function parsePlanDecision(
  text: string,
  { allowClarify = true }: { allowClarify?: boolean } = {},
): PlanDecision {
  const parsed = tolerantJsonParse(text);
  const action = String(parsed?.action ?? '').toUpperCase();
  const questions = cleanStringList(parsed?.questions, MAX_CLARIFY_QUESTIONS);
  const steps = cleanStringList(parsed?.steps, MAX_PLAN_STEPS);
  const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';

  if (action === 'CLARIFY' && allowClarify && questions.length > 0) {
    return { action: 'CLARIFY', questions, title: '', steps: [] };
  }
  if (action === 'PROCEED') {
    return { action: 'PROCEED', questions: [], title: '', steps: [] };
  }
  return { action: 'PLAN', questions: [], title, steps };
}

/**
 * Renders a PLAN card message (turn-1 output): the marker + resolved title on the
 * first line, then a numbered step list. Deterministic so the card can parse it back
 * and so it degrades to readable markdown in share/search/old clients. `title` must
 * be non-empty (the runner passes a fallback when the model omitted one).
 */
export function formatPlanMessage({ title, steps }: { title: string; steps: string[] }): string {
  const heading = `${PLAN_MARKER} ${title.trim()}`.trimEnd();
  const list = steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
  return `${heading}\n\n${list}`;
}

/** True if a message is a PLAN card (detected by the fixed marker). */
export function isPlanMessage(text: string): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(PLAN_MARKER);
}

/** True if a message is the exact "start research" command (button/autostart). */
export function isStartCommand(text: string): boolean {
  return typeof text === 'string' && text.trim() === START_MARKER;
}

/** True if a message is the exact "cancel research" command. */
export function isCancelCommand(text: string): boolean {
  return typeof text === 'string' && text.trim() === CANCEL_MARKER;
}

/**
 * Parses the numbered step list back out of a formatted plan message — the live
 * progress card renders these as its checklist. Deterministic inverse of
 * {@link formatPlanMessage} (tolerant of extra whitespace); empty if none match.
 */
export function extractPlanSteps(planMessage: string): string[] {
  const steps: string[] = [];
  for (const line of String(planMessage ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+(.*\S)\s*$/);
    if (match) {
      steps.push(match[1].trim());
    }
  }
  return steps;
}
