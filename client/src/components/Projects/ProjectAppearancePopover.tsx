import { memo, useCallback } from 'react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import {
  PROJECT_ICONS,
  PROJECT_COLORS,
  resolveColor,
} from './iconOptions';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: { icon: string; color: string };
  onChange: (next: { icon: string; color: string }) => void;
};

function ProjectAppearancePopover({ open, onOpenChange, value, onChange }: Props) {
  const localize = useLocalize();

  const handleIconChange = useCallback(
    (icon: string) => {
      onChange({ ...value, icon });
    },
    [onChange, value],
  );

  const handleColorChange = useCallback(
    (color: string) => {
      onChange({ ...value, color });
    },
    [onChange, value],
  );

  const currentHex = resolveColor(value.color);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md" aria-describedby="project-appearance-description">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_projects_appearance')}</OGDialogTitle>
        </OGDialogHeader>
        <div id="project-appearance-description" className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              {localize('com_projects_pick_color')}
            </span>
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => handleColorChange(c.name)}
                  aria-label={c.name}
                  aria-pressed={value.color === c.name}
                  style={{ backgroundColor: c.hex }}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                    value.color === c.name
                      ? 'border-text-primary ring-2 ring-offset-2 ring-offset-surface-primary'
                      : 'border-transparent',
                  )}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
              {localize('com_projects_pick_icon')}
            </span>
            <div className="grid grid-cols-6 gap-2">
              {PROJECT_ICONS.map(({ name, Icon }) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleIconChange(name)}
                  aria-label={name}
                  aria-pressed={value.icon === name}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg border transition-colors',
                    value.icon === name
                      ? 'border-text-primary bg-surface-hover'
                      : 'border-transparent hover:bg-surface-hover',
                  )}
                >
                  <Icon
                    className="h-5 w-5"
                    style={{ color: value.icon === name ? currentHex : undefined }}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

export default memo(ProjectAppearancePopover);
