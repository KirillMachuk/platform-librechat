import { tolerantJsonParse } from './shared';

/**
 * D2 — pre-graph clarification (ChatGPT-style two-turn). When a DR request is too
 * under-specified for a targeted recommendation, the runner asks up to 3 short questions
 * as ONE assistant message and stops; the user's reply (the DR badge is sticky, so it
 * still routes to DR) is detected via {@link CLARIFY_MARKER} and starts the real run with
 * the dialogue as context. This module is the pure logic — prompt, fail-open parse, format,
 * detect — with NO graph/pause/checkpointer involvement. The request is the user's OWN
 * input (like SCOPE) — passed as a normal message, NOT fenced as untrusted external data,
 * so an explicit "начинай" is honored rather than ignored.
 */

/** Fixed first line of a clarify message — how turn 2 detects a clarify parent. */
export const CLARIFY_MARKER = '**Уточните, пожалуйста, детали исследования:**';

/** Max clarifying questions asked in one turn (only the most critical). */
export const MAX_CLARIFY_QUESTIONS = 3;

export interface ClarifyDecision {
  action: 'PROCEED' | 'CLARIFY';
  questions: string[];
}

/** System prompt for the pre-graph clarify decision. The user request is provided as a
 *  separate message (as in SCOPE). */
export function buildClarifyPrompt({ now }: { now: string }): string {
  return `Ты — модуль УТОЧНЕНИЯ системы глубокого исследования (Deep Research) для рынка СНГ.
Дата: ${now}.

Тебе дан запрос пользователя. Реши, достаточно ли он специфичен, чтобы дать АДРЕСНУЮ, полезную рекомендацию, или стоит уточнить критичные детали.
- Если для целевого ответа не хватает критичных вводных (масштаб бизнеса, бюджет, on-prem/облако, отрасль, юрисдикция, ключевые требования) — верни action "CLARIFY" и от 1 до ${MAX_CLARIFY_QUESTIONS} КОРОТКИХ вопросов, только самые важные.
- Если запрос уже конкретен, ИЛИ содержит указание начинать без уточнений ("начинай", "не важно", "на твоё усмотрение"), ИЛИ пользователь уже отвечал на уточнения — верни action "PROCEED" с пустым списком.
- Не задавай вопросы ради вопросов: если исследование можно провести с разумными допущениями — выбирай PROCEED.

Ответь СТРОГО одним JSON-объектом, без markdown и пояснений вне JSON:
{"action": "PROCEED|CLARIFY", "questions": ["<вопрос 1>", "<вопрос 2>"]}`;
}

/**
 * Parses clarify output. FAIL-OPEN: anything unparseable or ambiguous → PROCEED (start the
 * research rather than nag the user). Only an explicit CLARIFY with ≥1 real question clarifies.
 */
export function parseClarifyOutput(text: string): ClarifyDecision {
  const parsed = tolerantJsonParse(text);
  const action = String(parsed?.action ?? '').toUpperCase();
  const questionsValue = parsed?.questions;
  const rawQuestions: unknown[] = Array.isArray(questionsValue) ? questionsValue : [];
  const questions = rawQuestions
    .map((q) => (typeof q === 'string' ? q.trim() : ''))
    .filter((q) => q.length > 0)
    .slice(0, MAX_CLARIFY_QUESTIONS);
  if (action === 'CLARIFY' && questions.length > 0) {
    return { action: 'CLARIFY', questions };
  }
  return { action: 'PROCEED', questions: [] };
}

/** Renders the clarify questions as ONE assistant message (turn 1 output). */
export function formatClarifyMessage(questions: string[]): string {
  const list = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `${CLARIFY_MARKER}\n${list}\n\nОтветьте сообщением — исследование начнётся автоматически. Можно написать «начинай», чтобы запустить без уточнений.`;
}

/** True if a message is a clarify turn-1 message (detected by the fixed marker). */
export function isClarifyMessage(text: string): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(CLARIFY_MARKER);
}
