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
