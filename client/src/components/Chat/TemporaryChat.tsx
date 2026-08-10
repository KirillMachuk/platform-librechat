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
              'tap-target inline-flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary',
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
