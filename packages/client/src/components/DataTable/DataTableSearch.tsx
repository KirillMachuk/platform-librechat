import { startTransition } from 'react';
import { memo, MemoExoticComponent } from 'react';
import { JSX } from 'react/jsx-runtime';
import type { DataTableSearchProps } from './DataTable.types';
import { useLocalize } from '~/hooks';
import { Input } from '../Input';
import { cn } from '~/utils';

export const DataTableSearch: MemoExoticComponent<
  ({ value, onChange, placeholder, className, disabled }: DataTableSearchProps) => JSX.Element
> = memo(
  ({
    value,
    onChange,
    placeholder,
    className,
    disabled = false,
  }: DataTableSearchProps): JSX.Element => {
    const localize = useLocalize();

    return (
      <div className="relative flex-1">
        <label htmlFor="table-search" className="sr-only">
          {localize('com_ui_search_table')}
        </label>
        <Input
          id="table-search"
          value={value}
          onChange={(e) => {
            startTransition(() => onChange(e.target.value));
          }}
          disabled={disabled}
          aria-label={localize('com_ui_search_table')}
          aria-describedby="search-description"
          placeholder={placeholder || localize('com_ui_search')}
          /**
           * Canon §6.4: a field is 36 on a desktop, 48 on a phone, radius 12,
           * with a `control` border — which is what `Input` already carries.
           *
           * This used to strip all of it: `border-0` and `rounded-b-none` fused
           * the input into the top edge of the table, so measured live it came
           * back as radius `12px 12px 0 0` with no border at all — the top of a
           * card rather than something you can type in. The heights were also
           * the wrong way round, 40 on a phone and 48 on a desktop, where the
           * canon and every other field in the product do the opposite.
           */
          className={cn('h-12 bg-surface-primary sm:h-9', className)}
        />
        <span id="search-description" className="sr-only">
          {localize('com_ui_search_table_description')}
        </span>
      </div>
    );
  },
);

DataTableSearch.displayName = 'DataTableSearch';
