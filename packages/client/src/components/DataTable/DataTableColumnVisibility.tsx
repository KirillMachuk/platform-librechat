import { useId, useMemo, useState } from 'react';
import { ListFilter } from 'lucide-react';
import * as Menu from '@ariakit/react/menu';
import type { Table } from '@tanstack/react-table';
import type { TranslationKeys } from '../../hooks';
import { useLocalize } from '../../hooks';
import DropdownPopup from '../DropdownPopup';
import { cn } from '~/utils';

interface DataTableColumnVisibilityProps<TData> {
  table: Table<TData>;
  contextMap: Record<string, TranslationKeys>;
  isSmallScreen?: boolean;
}

export function DataTableColumnVisibility<TData>({
  table,
  contextMap,
  isSmallScreen = false,
}: DataTableColumnVisibilityProps<TData>): JSX.Element {
  const localize = useLocalize();
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const dropdownItems = useMemo(
    () =>
      table
        .getAllColumns()
        .filter((column) => column.getCanHide())
        .map((column) => {
          const translationKey = contextMap[column.id];
          return {
            label: translationKey ? localize(translationKey) : column.id,
            onClick: () => column.toggleVisibility(!column.getIsVisible()),
            icon: column.getIsVisible() ? '✓' : '',
            id: column.id,
          };
        }),
    [table, contextMap, localize],
  );

  return (
    <DropdownPopup
      portal={false}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      trigger={
        <Menu.MenuButton
          aria-label={localize('com_files_filter_by')}
          className={cn(
            'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
            isSmallScreen && 'px-2 py-1',
          )}
        >
          <ListFilter className="size-3.5 sm:size-4" aria-hidden="true" />
        </Menu.MenuButton>
      }
      items={dropdownItems}
      menuId={menuId}
      className="z-50 max-h-[300px] overflow-y-auto"
    />
  );
}

export default DataTableColumnVisibility;
