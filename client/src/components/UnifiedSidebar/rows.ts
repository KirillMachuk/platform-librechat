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
 * «Новый чат» — единственная строка-карточка: рамка hairline, фон `card`,
 * вес 500. На 2px выше обычной строки (42 против 40) — так в прототипе:
 * главное действие сайдбара отделено от списка разделов.
 */
export const sidebarNewChatClassName =
  'mb-2.5 mt-1.5 flex h-12 w-full items-center gap-2.5 rounded-xl border border-border-light bg-surface-primary px-3 text-[15px] font-medium text-text-primary transition-colors duration-90 hover:bg-surface-hover md:h-[42px] md:text-sm';

/** Кнопка-иконка сайдбара (§6.2): 32×32, радиус 8, иконка 18, зона нажатия 44. */
export const sidebarIconButtonClassName =
  'tap-target flex h-8 w-8 flex-none items-center justify-center rounded-lg text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary';
