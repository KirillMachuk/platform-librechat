import React, { forwardRef } from 'react';
import { useWatch } from 'react-hook-form';
import { TooltipAnchor } from '@librechat/client';
import type { Control } from 'react-hook-form';
import { ArrowUp } from '~/components/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SendButtonProps = {
  disabled: boolean;
  control: Control<{ text: string }>;
};

const SubmitButton = React.memo(
  forwardRef((props: { disabled: boolean }, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const localize = useLocalize();
    return (
      <TooltipAnchor
        description={localize('com_nav_send_message')}
        render={
          <button
            ref={ref}
            aria-label={localize('com_nav_send_message')}
            id="send-button"
            disabled={props.disabled}
            className={cn(
              /* Канон §4: на телефоне САМА кнопка 44×44, как у кнопки-иконки
                 шапки. Зона нажатия не растягивается невидимым ::after по
                 горизонтали — абсолютный выступ попадал в прокручиваемое
                 переполнение предков и возвращал ленте боковое дёргание
                 (14.08). Круг рисует внутренний span, поэтому бокс растёт, а
                 чернила остаются канонными 38 (§6.13).
                 Отрицательные поля -3 возвращают СЛЕДУ кнопки прежние 38: канон
                 держит визуал меньше зоны, поэтому ряд не должен становиться
                 выше, а круг — уезжать от края. По горизонтали выступ съедает
                 собственный отступ ряда (pe-2), по вертикали его обрезает
                 composer-shell (overflow-hidden) — наружу не выходит ничего. */
              'tap-target -my-[3px] -me-[3px] flex h-11 w-11 items-center justify-center rounded-full outline-offset-4 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 md:my-0 md:me-0 md:h-9 md:w-9',
            )}
            data-testid="send-button"
            type="submit"
          >
            {/* Чернильный круг, стрелка цвета БУМАГИ (ink-label: белая в светлой,
                тёмная в тёмной — слова владельца 12.08). Прежний text-text-primary
                рисовал чернила по чернилам: у старой SendIcon был свой белый класс,
                и подмена глифа на голый ArrowUp это вскрыла. У выключенной кнопки
                стрелка та же — состояние говорит прозрачность, не цвет.
                Канон §6.13: круг 36 на десктопе и 38 на телефоне, иконка 20. */}
            <span
              className="flex size-[38px] items-center justify-center rounded-full bg-text-primary text-ink-label md:size-9"
              data-state="closed"
            >
              <ArrowUp size={20} aria-hidden="true" />
            </span>
          </button>
        }
      />
    );
  }),
);

const SendButton = React.memo(
  forwardRef((props: SendButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const data = useWatch({ control: props.control });
    const content = data?.text?.trim();
    return <SubmitButton ref={ref} disabled={props.disabled || !content} />;
  }),
);

export default SendButton;
