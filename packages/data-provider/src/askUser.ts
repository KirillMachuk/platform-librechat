/**
 * Ask-user questions (interactive cards К3) — the pure, shared primitives used
 * by BOTH the backend (the `ask_user` tool handler) and the frontend card.
 * Follows the deepResearch.ts pattern: fixed strings + tiny parsers, no
 * runtime deps, one source of truth for the wire format.
 *
 * Mechanics (owner-approved plan, INTERACTIVE_CARDS_Plan.md §4): the model
 * calls the `ask_user` tool with 1–3 questions; the run ends; the client
 * renders the tool call as an options card; «Продолжить» sends ONE ordinary
 * user message built by `buildAskAnswersMessage` (the model reads it as
 * text, no server-side routing needed); the chat renders that message as a
 * compact chip recognised by `isAskAnswersMessage`/`isAskSkipMessage`.
 */

export const ASK_USER_TOOL = 'ask_user';

/** Fixed first line of the user's answers message — how the chip recognises it. */
export const ASK_ANSWERS_MARKER = 'Ответы на вопросы:';

/** Exact text the «Пропустить» button sends. */
export const ASK_SKIP_MARKER = 'Пропустить вопросы';

export const ASK_MAX_QUESTIONS = 3;
export const ASK_MIN_OPTIONS = 2;
export const ASK_MAX_OPTIONS = 6;
const MAX_PROMPT_CHARS = 300;
const MAX_OPTION_CHARS = 120;
const MAX_ANSWER_CHARS = 500;

export interface AskUserQuestion {
  id: string;
  prompt: string;
  options: string[];
}

/**
 * Parses and CLAMPS the tool-call arguments into renderable questions.
 * Tolerant by design — the args stream in chunks and models improvise:
 * returns null until the JSON is complete and at least one valid question
 * (non-empty prompt + 2..6 non-empty options) exists; extra questions and
 * options beyond the caps are dropped, strings trimmed and length-capped.
 */
export function parseAskUserArgs(args: unknown): AskUserQuestion[] | null {
  let raw: unknown = args;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const list = (raw as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) {
    return null;
  }
  const questions: AskUserQuestion[] = [];
  for (const item of list) {
    if (questions.length >= ASK_MAX_QUESTIONS) {
      break;
    }
    const prompt =
      typeof (item as { prompt?: unknown })?.prompt === 'string'
        ? (item as { prompt: string }).prompt.trim().slice(0, MAX_PROMPT_CHARS)
        : '';
    const rawOptions = (item as { options?: unknown })?.options;
    const options = Array.isArray(rawOptions)
      ? [
          ...new Set(
            rawOptions
              .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
              .map((o) => o.trim().slice(0, MAX_OPTION_CHARS)),
          ),
        ].slice(0, ASK_MAX_OPTIONS)
      : [];
    if (!prompt || options.length < ASK_MIN_OPTIONS) {
      continue;
    }
    const id =
      typeof (item as { id?: unknown })?.id === 'string' && (item as { id: string }).id.trim()
        ? (item as { id: string }).id.trim()
        : `q${questions.length + 1}`;
    questions.push({ id, prompt, options });
  }
  return questions.length > 0 ? questions : null;
}

/**
 * The ONE user message carrying all answers: marker line + «N) prompt — answer»
 * per question, in question order. Plain numbered text so the model reads it
 * without any parsing, and the chip parser below can reconstruct the pairs.
 */
export function buildAskAnswersMessage(
  questions: AskUserQuestion[],
  answers: Record<string, string>,
): string {
  const lines = questions.map((q, i) => {
    const answer = (answers[q.id] ?? '').trim().slice(0, MAX_ANSWER_CHARS);
    return `${i + 1}) ${q.prompt} — ${answer}`;
  });
  return `${ASK_ANSWERS_MARKER}\n${lines.join('\n')}`;
}

/** True if a user message is the answers summary (chip rendering keys on this). */
export function isAskAnswersMessage(text: string): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(ASK_ANSWERS_MARKER);
}

/** True if a user message is the skip command. */
export function isAskSkipMessage(text: string): boolean {
  return typeof text === 'string' && text.trim() === ASK_SKIP_MARKER;
}

/** Pairs for the chip: [{prompt, answer}] parsed back out of the summary text. */
export function parseAskAnswersMessage(text: string): { prompt: string; answer: string }[] {
  if (!isAskAnswersMessage(text)) {
    return [];
  }
  return text
    .split('\n')
    .slice(1)
    .map((line) => {
      const m = /^\d+\)\s*(.*?)\s+—\s+(.*)$/.exec(line.trim());
      return m ? { prompt: m[1], answer: m[2] } : null;
    })
    .filter((p): p is { prompt: string; answer: string } => p != null);
}

/** True if a message's content carries an `ask_user` tool call — the
 *  provenance anchor for rendering the answers/skip chip under it. */
export function contentHasAskUserCall(
  content: { type?: string; tool_call?: { name?: string } }[] | undefined | null,
): boolean {
  return (
    content?.some(
      (part) => part?.type === 'tool_call' && part.tool_call?.name === ASK_USER_TOOL,
    ) === true
  );
}
