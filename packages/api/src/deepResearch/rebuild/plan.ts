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
 * - PROCEED  → run the graph immediately (the fail-open default, and the model's
 *   choice when a plan adds nothing).
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
 */
export function buildPlanPrompt({
  now,
  allowClarify = true,
}: {
  now: string;
  allowClarify?: boolean;
}): string {
  const clarifyRule = allowClarify
    ? `- Если для АДРЕСНОЙ рекомендации не хватает критичных вводных (масштаб бизнеса, бюджет, on-prem/облако, отрасль, юрисдикция, ключевые требования) — верни action "CLARIFY" и от 1 до ${MAX_CLARIFY_QUESTIONS} КОРОТКИХ вопросов, только самые важные. Не задавай вопросы ради вопросов.`
    : `- Пользователю уже задавали уточнения (или он просил начинать) — БОЛЬШЕ НЕ УТОЧНЯЙ. Действие "CLARIFY" запрещено; выбирай "PLAN".`;
  return `Ты — модуль ПЛАНИРОВАНИЯ системы глубокого исследования (Deep Research) для рынка СНГ.
Дата: ${now}.

Тебе дан запрос пользователя (или диалог уточнения). Реши, что вернуть:
${clarifyRule}
- Иначе верни action "PLAN": короткий ПЛАН исследования из 3–6 шагов. Каждый шаг — сжатая формулировка действия (глагол в инфинитиве). ПОСЛЕДНИЙ шаг ВСЕГДА описывает формат результата (например, «Сформировать сравнительную таблицу и рекомендацию»). Также верни "title" — короткую ТЕМУ исследования в именительном падеже (3–7 слов, это тема, а не команда, без кавычек).
- Если запрос предельно ясен и план не нужен — верни action "PROCEED".

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
 * Parses the decision. FAIL-OPEN: anything unparseable or ambiguous → PROCEED (start
 * research rather than block the user on a bad model turn). Only an explicit CLARIFY
 * with ≥1 question clarifies; only an explicit PLAN with ≥1 step shows a card. When
 * `allowClarify` is false a CLARIFY result is downgraded to PROCEED (anti-loop).
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
  if (action === 'PLAN' && steps.length > 0) {
    return { action: 'PLAN', questions: [], title, steps };
  }
  return { action: 'PROCEED', questions: [], title: '', steps: [] };
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
