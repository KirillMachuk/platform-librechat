/**
 * Deep Research UX (task #21) — the pure, shared plan-gate primitives used by BOTH the
 * backend (packages/api `plan.ts` re-exports these) and the frontend plan card. Fixed
 * strings + tiny parsers only; no runtime deps, so the single source of truth can't drift
 * between the runner that emits a plan message and the card that renders it.
 */

/** Fixed first line of a PLAN card message — how a plan turn is detected. */
export const DR_PLAN_MARKER = '**План исследования:**';

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
