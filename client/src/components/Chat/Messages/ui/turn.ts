/**
 * Single source for the user-turn bubble used by all three message renderers
 * (MessageRender, ContentRender, MessageParts) — width/color/radius changes
 * must stay a one-line edit. 85% on phones, 70% from md up (ChatGPT parity);
 * overflow-wrap covers unbroken tokens (long URLs/keys) inside markdown.
 */
export const USER_BUBBLE_CLASS =
  'max-w-[85%] rounded-3xl bg-bubble px-4 py-2.5 text-[length:var(--markdown-font-size)] leading-[1.55] [overflow-wrap:anywhere] md:max-w-[78%]';
