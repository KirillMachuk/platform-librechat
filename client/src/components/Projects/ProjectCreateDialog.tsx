import { memo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Input,
  Label,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import { useCreateProjectMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { NotificationSeverity } from '~/common';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ProjectCreateDialog({ open, onOpenChange }: Props) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');

  const reset = useCallback(() => {
    setName('');
    setDescription('');
    setInstructions('');
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
      navigate(`/p/${project.projectId}`);
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
    });
  }, [name, description, instructions, createMutation]);

  return (
    <OGDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <OGDialogContent className="w-11/12 max-w-lg" aria-describedby="project-create-description">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_projects_create_title')}</OGDialogTitle>
        </OGDialogHeader>
        <div
          id="project-create-description"
          className="flex flex-col gap-3 pt-2"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="project-name">{localize('com_projects_name')}</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={localize('com_projects_name_placeholder')}
              autoFocus
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="project-description">
              {localize('com_projects_description')}
            </Label>
            <Input
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={localize('com_projects_description_placeholder')}
              maxLength={500}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="project-instructions">
              {localize('com_projects_instructions')}
            </Label>
            <textarea
              id="project-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={localize('com_projects_instructions_placeholder')}
              className="min-h-[120px] w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={20000}
            />
          </div>
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
    </OGDialog>
  );
}

export default memo(ProjectCreateDialog);
