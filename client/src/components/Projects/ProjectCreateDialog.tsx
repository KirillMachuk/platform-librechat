import { memo, useCallback, useState } from 'react';
import {
  Button,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { TProject } from 'librechat-data-provider';
import { DEFAULT_PROJECT_ICON, DEFAULT_PROJECT_COLOR } from './iconOptions';
import ProjectAppearancePopover from './ProjectAppearancePopover';
import { useCreateProjectMutation } from '~/data-provider';
import ProjectFormFields from './ProjectFormFields';
import { NotificationSeverity } from '~/common';
import { Info } from '~/components/icons';
import { useLocalize } from '~/hooks';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: TProject) => void;
};

function ProjectCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [appearance, setAppearance] = useState({
    icon: DEFAULT_PROJECT_ICON,
    color: DEFAULT_PROJECT_COLOR,
  });
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const reset = useCallback(() => {
    setName('');
    setDescription('');
    setInstructions('');
    setAppearance({ icon: DEFAULT_PROJECT_ICON, color: DEFAULT_PROJECT_COLOR });
  }, []);

  const createMutation = useCreateProjectMutation({
    onSuccess: (project) => {
      showToast({
        message: localize('com_projects_create_success'),
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      });
      onOpenChange(false);
      reset();
      onCreated?.(project);
    },
    onError: () => {
      showToast({
        message: localize('com_projects_create_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({
      name: trimmed,
      description: description.trim(),
      instructions: instructions.trim(),
      icon: appearance.icon,
      color: appearance.color,
    });
  }, [name, description, instructions, appearance, createMutation]);

  return (
    <OGDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      {/* Canon §4: dialogs are 420 / 560 / 720. */}
      <OGDialogContent
        className="w-11/12 max-w-[560px]"
        aria-describedby="project-create-description"
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_projects_create_title')}</OGDialogTitle>
        </OGDialogHeader>
        <div id="project-create-description" className="flex flex-col gap-3 pt-2">
          <div className="flex items-start gap-2 rounded-xl border border-border-light bg-surface-secondary px-3 py-2 text-[13px] text-text-secondary">
            <Info className="icon-sm mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{localize('com_projects_create_hint')}</span>
          </div>
          <ProjectFormFields
            idPrefix="project"
            name={name}
            description={description}
            instructions={instructions}
            appearance={appearance}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onInstructionsChange={setInstructions}
            onOpenAppearance={() => setAppearanceOpen(true)}
          />
        </div>
        <div className="flex justify-end gap-3 pt-4">
          <OGDialogClose asChild>
            <Button variant="outline">{localize('com_ui_cancel')}</Button>
          </OGDialogClose>
          <Button
            variant="default"
            onClick={handleSubmit}
            disabled={!name.trim() || createMutation.isLoading}
          >
            {createMutation.isLoading ? <Spinner /> : localize('com_projects_create_submit')}
          </Button>
        </div>
      </OGDialogContent>
      <ProjectAppearancePopover
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        value={appearance}
        onChange={setAppearance}
      />
    </OGDialog>
  );
}

export default memo(ProjectCreateDialog);
