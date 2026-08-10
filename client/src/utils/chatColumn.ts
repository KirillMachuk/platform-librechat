/**
 * One source for how wide the chat column is.
 *
 * The thread, the composer and the scroll-to-bottom button have to agree on it,
 * because a person does not read them as three boxes — they read one column,
 * and any disagreement shows up as the composer sitting off-centre under the
 * conversation. There were five copies of these numbers and they had drifted:
 * the composer carried its own `sm:px-2`, so in the ordinary case it was 16px
 * narrower than the thread it sat under, and in the wide-chat mode the thread
 * was padded by 20 and the composer by 8.
 *
 * The prototype states the rule plainly (screen 2, `.dcol` / `.dcomp`): both
 * boxes are 768 wide, and the text's inset comes from the column's own padding,
 * inside that width — so the outer edges coincide exactly.
 *
 * `parallel` is the comparison mode, where the thread is allowed to be wider.
 * The composer does not pass it: there is one composer under two columns, and
 * which width it should take there is a design question, not a copy of this one.
 */
export const chatColumnClass = (maximize: boolean, parallel = false): string => {
  if (maximize) {
    return 'w-full max-w-full md:px-5 lg:px-1 xl:px-5';
  }
  if (parallel) {
    return 'md:max-w-[58rem] xl:max-w-[70rem]';
  }
  return 'md:max-w-[48rem]';
};
