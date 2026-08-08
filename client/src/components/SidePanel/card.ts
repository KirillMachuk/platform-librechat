/**
 * Canon §4 / §6.15: with the artifacts panel open the working area and the
 * panel are TWO cards — same radius 16, same hairline, same `bg` fill, same
 * `shadow-sm` — and the 8px gap between them is the drag handle, so there is no
 * divider strip.
 *
 * One string, imported by both panels, because the failure this replaced was
 * exactly a drift between them: one card with a rule down the middle reads as a
 * region of the chat rather than a surface beside it.
 */
export const PANEL_CARD =
  'h-full overflow-hidden rounded-2xl border border-border-light bg-presentation shadow-sm';
