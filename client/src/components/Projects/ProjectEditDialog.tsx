import { memo, useCallback, useEffect, useState } from 'react';
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
import type { TProject } from 'librechat-data-provider';
import { useDeleteProjectMutation, useUpdateProjectMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { NotificationSeverity } from '~/common';
import ProjectAppearancePopover from './ProjectAppearancePopover';
import {
  DEFAULT_PROJECT_ICON,
  DEFAULT_PROJECT_COLOR,
  resolveIcon,
  resolveColor,
} from './iconOptions';

type Props = {
  project: TProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

function ProjectEditDialog({ project, open, onOpenChange, onDeleted }: Props) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [instructions, setInstructions] = useState(project.instructions);
  const [appearance, setAppearance] = useState({
    icon: project.icon ?? DEFAULT_PROJECT_ICON,
    color: project.color ?? DEFAULT_PROJECT_COLOR,
  });
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName(project.name);
      setDescription(project.description);
      setInstructions(project.instructions);
      setAppearance({
        icon: project.icon ?? DEFAULT_PROJECT_ICON,
        color: project.color ?? DEFAULT_PROJECT_COLOR,
      });
    }
  }, [open, project]);

  const updateMutation = useUpdateProjectMutation(project.projectId, {
    onSuccess: () => {
      showToast({
        message: localize('com_projects_update_success'),
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      });
      onOpenChange(false);
    },
    onError: () => {
      showToast({
        message: localize('com_projects_update_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const deleteMutation = useDeleteProjectMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_projects_delete_success'),
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      });
      onOpenChange(false);
      if (onDeleted) {
        onDeleted();
      } else {
        navigate('/c/new');
      }
    },
    onError: () => {
      showToast({
        message: localize('com_projects_delete_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });

  const handleSubmit = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    updateMutation.mutate({
      name: trimmedName,
      description: description.trim(),
      instructions: instructions.trim(),
      icon: appearance.icon,
      color: appearance.color,
    });
  }, [name, description, instructions, appearance, updateMutation]);

  const Icon = resolveIcon(appearance.icon);
  const iconHex = resolveColor(appearance.color);

  const handleDelete = useCallback(() => {
    if (!window.confirm(localize('com_projects_delete_confirm', { name: project.name }))) {
      return;
    }
    deleteMutation.mutate(project.projectId);
  }, [deleteMutation, localize, project.name, project.projectId]);

  const isBusy = updateMutation.isLoading || deleteMutation.isLoading;

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-lg" aria-describedby="project-edit-description">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_projects_edit_title')}</OGDialogTitle>
        </OGDialogHeader>
        <div id="project-edit-description" className="flex flex-col gap-3 pt-2">
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => setAppearanceOpen(true)}
              aria-label={localize('com_projects_appearance')}
              className="flex h-16 w-16 items-center justify-center rounded-full border border-border-light transition-transform hover:scale-105"
              style={{ backgroundColor: `${iconHex}1a` }}
            >
              <Icon className="h-8 w-8" style={{ color: iconHex }} aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="project-edit-name">{localize('com_projects_name')}</Label>
            <Input
              id="project-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="project-edit-description">{localize('com_projects_description')}</Label>
            <Input
              id="project-edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="project-edit-instructions">
              {localize('com_projects_instructions')}
            </Label>
            <textarea
              id="project-edit-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[160px] w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={20000}
            />
          </div>
        </div>
        <div className="flex justify-between gap-3 pt-4">
          <Button variant="destructive" onClick={handleDelete} disabled={isBusy}>
            {deleteMutation.isLoading ? <Spinner /> : localize('com_projects_delete')}
          </Button>
          <div className="flex gap-3">
            <OGDialogClose asChild>
              <Button variant="outline">{localize('com_ui_cancel')}</Button>
            </OGDialogClose>
            <Button variant="default" onClick={handleSubmit} disabled={!name.trim() || isBusy}>
              {updateMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
            </Button>
          </div>
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

export default memo(ProjectEditDialog);
