import { memo } from 'react';
import { Label, FIELD_BASE, FIELD_BORDER } from '@librechat/client';
import { resolveIcon, resolveColor } from './iconOptions';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type Appearance = { icon: string; color: string };

type Props = {
  /** Distinguishes the two dialogs' field ids from each other. */
  idPrefix: string;
  name: string;
  description: string;
  instructions: string;
  appearance: Appearance;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onInstructionsChange: (value: string) => void;
  onOpenAppearance: () => void;
};

/**
 * The three things a project is, and how it looks in a list — the same in the
 * create dialog and in the settings one, so they share this rather than each
 * keeping a copy that drifts.
 *
 * Canon §6.4: label above the control, field 36 (48 on a phone) at radius 12.
 */
function ProjectFormFields({
  idPrefix,
  name,
  description,
  instructions,
  appearance,
  onNameChange,
  onDescriptionChange,
  onInstructionsChange,
  onOpenAppearance,
}: Props) {
  const localize = useLocalize();
  const Icon = resolveIcon(appearance.icon);
  const iconHex = resolveColor(appearance.color);

  return (
    <div className="flex flex-col gap-3">
      {/* The circle is a control, and nothing said so — the caption under it
          is what tells you it opens the colour and icon picker. */}
      <div className="flex flex-col items-center gap-1 pb-1">
        <button
          type="button"
          onClick={onOpenAppearance}
          aria-label={localize('com_projects_appearance')}
          className="flex h-16 w-16 items-center justify-center rounded-full border border-border-light transition-transform hover:scale-105 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary"
          style={{ backgroundColor: `${iconHex}1a` }}
        >
          <Icon className="h-8 w-8" style={{ color: iconHex }} aria-hidden="true" />
        </button>
        <span className="text-[12.5px] text-text-secondary">
          {localize('com_projects_appearance_hint')}
        </span>
      </div>

      <div className="flex flex-col gap-[5px]">
        <Label htmlFor={`${idPrefix}-name`}>{localize('com_projects_name')}</Label>
        <input
          id={`${idPrefix}-name`}
          className={cn(FIELD_BASE, FIELD_BORDER)}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={localize('com_projects_name_placeholder')}
          maxLength={120}
        />
      </div>

      <div className="flex flex-col gap-[5px]">
        <Label htmlFor={`${idPrefix}-description`}>
          {localize('com_projects_description')}{' '}
          <span className="text-text-secondary">{localize('com_ui_optional')}</span>
        </Label>
        <input
          id={`${idPrefix}-description`}
          className={cn(FIELD_BASE, FIELD_BORDER)}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder={localize('com_projects_description_placeholder')}
          maxLength={500}
        />
      </div>

      <div className="flex flex-col gap-[5px]">
        <Label htmlFor={`${idPrefix}-instructions`}>
          {localize('com_projects_instructions')}{' '}
          <span className="text-text-secondary">{localize('com_ui_optional')}</span>
        </Label>
        <textarea
          id={`${idPrefix}-instructions`}
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          placeholder={localize('com_projects_instructions_placeholder')}
          className={cn(FIELD_BASE, FIELD_BORDER, 'h-auto min-h-[120px] py-2 sm:h-auto')}
          maxLength={20000}
        />
      </div>
    </div>
  );
}

export default memo(ProjectFormFields);
