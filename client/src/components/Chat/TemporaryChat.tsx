import React from 'react';
import { useRecoilValue } from 'recoil';
import { TooltipAnchor } from '@librechat/client';
import { useRecoilState, useRecoilCallback } from 'recoil';
import { MessageCircleDashed } from '~/components/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

export function TemporaryChat() {
  const localize = useLocalize();
  const [isTemporary, setIsTemporary] = useRecoilState(store.isTemporary);
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(0));

  const handleBadgeToggle = useRecoilCallback(
    () => () => {
      setIsTemporary(!isTemporary);
    },
    [isTemporary],
  );

  if (
    (Array.isArray(conversation?.messages) && conversation.messages.length >= 1) ||
    isSubmitting
  ) {
    return null;
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <TooltipAnchor
        description={localize('com_ui_temporary')}
        render={
          <button
            onClick={handleBadgeToggle}
            aria-label={localize('com_ui_temporary')}
            aria-pressed={isTemporary}
            className={cn(
              /* Канон §7: на телефоне кнопка-иконка шапки САМА 44, §6.2: на
                 десктопе 32 — Header.tsx рендерит эту кнопку в обеих шапках.
                 `h-11 w-11 … md:h-8 md:w-8`, а не `size-*`: tailwind-merge 1.14
                 группу `size-*` не знает, пара базовый/md через неё не
                 прошла бы. */
              'tap-target inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary md:h-8 md:w-8',
              /* Канон §7: включённый временный чат — `acc` на `acc-soft`.
                 Выключенный — обычная кнопка-иконка, без заливки и тени. */
              isTemporary && 'bg-acc-soft text-text-accent hover:text-text-accent',
            )}
          >
            <MessageCircleDashed className="icon-md" aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}
