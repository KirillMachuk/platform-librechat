/**
 * Вид строк сайдбара живёт в одном месте: одинаково выглядят навигационные
 * строки, строка поиска и «Новый чат», и они собираются в трёх разных файлах.
 *
 * Канон §4 и §6.5, поверх него решение владельца 11.08: строка бокового
 * меню — 40 на десктопе, 48 на телефоне, радиус 12, зазор 12; подпись И
 * иконка носят ОДИН цвет — `sidebar-ink` (книжные t2/t3 владельцу тусклы,
 * ориентир — Kimi; разные цвета подписи и иконки он назвал «бардаком»).
 * Иконка 20 на всех ширинах — так книга и рисует ряды d02, лестница §4
 * (18/20) на этот частный случай не распространяется, поэтому размер задан
 * числом, как и у других «частных мест» канона. Наведение красит фон
 * `hover` и поднимает цвет до t1 — в тёмной теме это лёгкое высветление.
 */
export const sidebarRowClassName =
  'group flex h-12 w-full items-center gap-3 rounded-xl px-2.5 text-[15px] font-normal text-sidebar-ink transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary md:h-10 md:text-sm';

export const sidebarRowIconClassName =
  'h-5 w-5 flex-shrink-0 text-sidebar-ink transition-colors duration-90 group-hover:text-text-primary';

/**
 * The open section (canon §6.5, rewritten by the owner's decision of 10.08 late
 * evening): a selected sidebar row is NEUTRAL — `active` tint plus t1 text and
 * t1 icon. Exactly what the active conversation row further down the same
 * sidebar already wears (Convo.tsx: `bg-surface-active text-text-primary`), so
 * the two selected states finally read as one state.
 *
 * Petrol is off this role for good: §1.1 lists every place the brand colour is
 * still allowed and names «раздел сайдбара» as excluded from it. Do not
 * restore `acc-soft`/`text-text-accent` here.
 *
 * Hover is restated on purpose — the base row paints hover as `hover`/t1, so
 * without these the tint would drop out from under the cursor.
 */
export const sidebarRowActiveClassName =
  'bg-surface-active text-text-primary hover:bg-surface-active hover:text-text-primary';

export const sidebarRowActiveIconClassName = 'text-text-primary group-hover:text-text-primary';

/**
 * «Новый чат» — единственная строка-карточка: рамка hairline, фон `card`,
 * вес 500. На 2px выше обычной строки (42 против 40) — так в прототипе:
 * главное действие сайдбара отделено от списка разделов.
 *
 * The prototype's `.dside .nnew` override touches height and margin only, so
 * the 15px of the base `.nnew` stays 15px on a desktop — unlike a section row,
 * which the same override does drop to 14.
 */
export const sidebarNewChatClassName =
  'mb-2.5 mt-1.5 flex h-12 w-full items-center gap-2.5 rounded-xl border border-border-light bg-surface-primary px-3 text-[15px] font-medium text-text-primary transition-colors duration-90 hover:bg-surface-hover md:h-[42px]';

/** Кнопка-иконка сайдбара (§6.2): 32×32, радиус 8, иконка 18, зона нажатия 44. */
export const sidebarIconButtonClassName =
  'tap-target flex h-8 w-8 flex-none items-center justify-center rounded-lg text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary';
