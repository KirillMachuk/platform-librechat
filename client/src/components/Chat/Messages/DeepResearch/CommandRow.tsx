import { useRecoilValue } from 'recoil';
import type { TMessageProps } from '~/common';
import SiblingSwitch from '~/components/Chat/Messages/SiblingSwitch';
import SubRow from '~/components/Chat/Messages/SubRow';
import { cn, chatColumnClass } from '~/utils';
import store from '~/store';

/**
 * What is left of a Deep Research command row once the row itself is hidden.
 *
 * The commands («Начать исследование», «Отменить исследование») are the card's buttons
 * speaking, not the user typing, so their bubbles are hidden (r25, owner). A command that
 * carries SIBLINGS keeps its switcher: an edit-and-resend put a real branch there, and
 * hiding the row wholesale made that branch unreachable (r25a review).
 *
 * Both render paths — `ContentRender` and `MessageRender` — used to carry their own copy
 * of this row, and both copies still spelled out the chat column as `md:max-w-[47rem]
 * xl:max-w-[55rem]`, the numbers from before `chatColumnClass` became the one source for
 * the column's width. So the row sat in a box of its own, wider than the thread and
 * without its side padding, and its `justify-end` could not push anything anywhere,
 * because the flex child it lived on was only as wide as the digits inside it. The
 * switcher landed to the LEFT of the card it belongs to (owner, r29). One component, the
 * shared column helper, and a row that actually spans it.
 */
export default function CommandRow({
  siblingIdx,
  siblingCount,
  setSiblingIdx,
  hasParallelContent = false,
}: Pick<TMessageProps, 'siblingIdx' | 'siblingCount' | 'setSiblingIdx'> & {
  hasParallelContent?: boolean;
}) {
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  if ((siblingCount ?? 1) <= 1) {
    return null;
  }

  return (
    <div
      className={cn(
        'mx-auto flex flex-1 gap-3',
        chatColumnClass(maximizeChatSpace, hasParallelContent),
      )}
    >
      {/* The command is a USER turn, so its switcher sits on the user's side —
          the same place the normal path puts it for a message with a bubble. */}
      <SubRow classes="w-full justify-end text-xs">
        <SiblingSwitch
          siblingIdx={siblingIdx}
          siblingCount={siblingCount}
          setSiblingIdx={setSiblingIdx}
        />
      </SubRow>
    </div>
  );
}
