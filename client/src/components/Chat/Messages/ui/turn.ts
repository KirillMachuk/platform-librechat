/**
 * The width ceiling of anything that stands in for the user's own turn: the
 * bubble, and the answers chip that replaces it (design review 02.09, В4 — the
 * chip used to restate these numbers by hand). 85% on phones, 78% from md up.
 */
export const USER_BUBBLE_WIDTH_CLASS = 'max-w-[85%] md:max-w-[78%]';

/**
 * Single source for the user-turn bubble used by all four message renderers
 * (MessageRender, ContentRender, MessageParts, Share/Message) — width/color/radius
 * changes must stay a one-line edit (ChatGPT parity on the widths); overflow-wrap
 * covers unbroken tokens (long URLs/keys) inside markdown.
 */
export const USER_BUBBLE_CLASS = `${USER_BUBBLE_WIDTH_CLASS} rounded-3xl bg-bubble px-4 py-2.5 text-[length:var(--markdown-font-size)] leading-[1.55] [overflow-wrap:anywhere]`;

/**
 * An icon button in the action row under a message: 28px to the eye, and to
 * a finger a 44 box in BOTH directions (canon §4). The `tap-target` helper
 * grows height only — its sideways ::after fed the scroller and stole
 * neighbours' taps (14.08) — so under a coarse pointer the button itself is
 * the box, the icon stays 16, and the row's gap goes to zero (pitch 44). One
 * recipe for HoverButton and the feedback thumbs; two copies had already
 * drifted once (visibility, §6.14).
 */
export const ACTION_ROW_BUTTON_CLASS =
  'hover-button tap-target flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary-alt [&_svg]:h-4 [&_svg]:w-4 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
