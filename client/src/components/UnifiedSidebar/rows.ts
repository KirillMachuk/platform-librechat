/**
 * Вид строк сайдбара живёт в одном месте: одинаково выглядят навигационные
 * строки, строка поиска и «Новый чат», и они собираются в трёх разных файлах.
 *
 * Канон §4 и §6.5: строка бокового меню — 40 на десктопе, 48 на телефоне,
 * радиус 12, зазор 12, текст t2, иконка 18 (на телефоне 20) цвета t3;
 * наведение красит фон `hover` и поднимает и текст, и иконку до t1.
 */
export const sidebarRowClassName =
  'group flex h-12 w-full items-center gap-3 rounded-xl px-2.5 text-[15px] font-normal text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary md:h-10 md:text-sm';

export const sidebarRowIconClassName =
  'icon-md flex-shrink-0 text-text-tertiary transition-colors duration-90 group-hover:text-text-primary';

/**
 * The open section (canon §6.5, `.nrow.on` in the prototype): `acc-soft` fill,
 * `acc` text AND `acc` icon.
 *
 * Hover is restated on purpose — the base row paints hover as `hover`/t1, so
 * without these the accent would drop out from under the cursor.
 */
/* bg-acc-soft, NOT the focus-ring token it borrowed before: the day focus
 * went neutral, --ring-primary-soft went transparent and the tint of the
 * open section silently vanished. Selection has its own token (§1.4). */
export const sidebarRowActiveClassName =
  'bg-acc-soft text-text-accent hover:bg-acc-soft hover:text-text-accent';

export const sidebarRowActiveIconClassName = 'text-text-accent group-hover:text-text-accent';

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
