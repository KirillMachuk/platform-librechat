/**
 * Deep Research UX (task #21) — the pure, shared plan-gate primitives used by BOTH the
 * backend (packages/api `plan.ts` re-exports these) and the frontend plan card. Fixed
 * strings + tiny parsers only; no runtime deps, so the single source of truth can't drift
 * between the runner that emits a plan message and the card that renders it.
 */

/**
 * Machine-readable provenance of a Deep-Research message, persisted as `message.drKind`
 * by the runner when it CREATES the message. This — not the display text — is what the
 * client card mount and the backend turn routing key on: prose that merely LOOKS like a
 * plan (a normal chat answer starting with the marker text) must never grow live buttons
 * or route a follow-up into DR. The text markers below remain the display format and the
 * wire format of the user's start/cancel commands.
 *
 * 'aborted' marks a research turn the user STOPPED before it produced a valid report.
 * Unlike 'report' (a valid terminal answer → the next message is normal chat), an
 * 'aborted' turn routes the next user message back into planning: Stop + a follow-up
 * comment re-plans the ORIGINAL plan with that comment, instead of starting fresh.
 */
export const DR_KINDS = ['plan', 'clarify', 'start', 'cancel', 'report', 'aborted'] as const;
export type DrKind = (typeof DR_KINDS)[number];

/** Fixed first line of a PLAN card message — how a plan turn is detected. */
export const DR_PLAN_MARKER = '**План исследования:**';

/** Fixed first line of a CLARIFY message (mirrors packages/api clarify.ts CLARIFY_MARKER).
 *  Used only to recognise a DR assistant turn when detecting the report that follows it. */
export const DR_CLARIFY_MARKER = '**Уточните, пожалуйста, детали исследования:**';

/** Exact text the "Начать" button / autostart sends as the user's turn-2 message. */
export const DR_START_MARKER = '▶ Начать исследование';

/** Exact text the "Отменить" button sends as the user's turn-2 message. */
export const DR_CANCEL_MARKER = '✕ Отменить исследование';

/** Terminal assistant message after a cancel — carries NO DR marker. */
export const DR_CANCELLED_MESSAGE = 'Исследование отменено.';

/** True if a message is a PLAN card (detected by the fixed marker). */
export function isDrPlanMessage(text: string): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(DR_PLAN_MARKER);
}

/** True if a message is a DR assistant turn that a user reply continues into research —
 *  a PLAN card or a CLARIFY questions message. Used to recognise a report by its ancestry. */
export function isDrAssistantTurn(text: string): boolean {
  if (typeof text !== 'string') {
    return false;
  }
  const head = text.trimStart();
  return head.startsWith(DR_PLAN_MARKER) || head.startsWith(DR_CLARIFY_MARKER);
}

/** True if a message is the exact "start research" command (button/autostart). */
export function isDrStartCommand(text: string): boolean {
  return typeof text === 'string' && text.trim() === DR_START_MARKER;
}

/** True if a message is the exact "cancel research" command. */
export function isDrCancelCommand(text: string): boolean {
  return typeof text === 'string' && text.trim() === DR_CANCEL_MARKER;
}

/** Parses the numbered step list out of a formatted plan message (for the card checklist). */
export function extractDrPlanSteps(planMessage: string): string[] {
  const steps: string[] = [];
  for (const line of String(planMessage ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+(.*\S)\s*$/);
    if (match) {
      steps.push(match[1].trim());
    }
  }
  return steps;
}

/** Splits a plan message into its title (first line after the marker) and its steps. */
export function parseDrPlanMessage(text: string): { title: string; steps: string[] } {
  const raw = String(text ?? '');
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? '';
  const title = firstLine.trimStart().startsWith(DR_PLAN_MARKER)
    ? firstLine.trimStart().slice(DR_PLAN_MARKER.length).trim()
    : '';
  return { title, steps: extractDrPlanSteps(raw) };
}
