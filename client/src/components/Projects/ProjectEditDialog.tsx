import { memo, useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Label,
  Button,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogTrigger,
  OGDialogContent,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TProject } from 'librechat-data-provider';
import { useDeleteProjectMutation, useUpdateProjectMutation } from '~/data-provider';
import { DEFAULT_PROJECT_ICON, DEFAULT_PROJECT_COLOR } from './iconOptions';
import ProjectAppearancePopover from './ProjectAppearancePopover';
import ProjectFormFields from './ProjectFormFields';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

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

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(project.projectId);
  }, [deleteMutation, project.projectId]);

  const isBusy = updateMutation.isLoading || deleteMutation.isLoading;

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      {/* Canon §4: dialogs are 420 / 560 / 720. */}
      <OGDialogContent className="w-11/12 max-w-[560px]" aria-describedby="project-edit-body">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_projects_edit_title')}</OGDialogTitle>
        </OGDialogHeader>
        <div id="project-edit-body" className="flex flex-col gap-3 pt-2">
          <ProjectFormFields
            idPrefix="project-edit"
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
        <div className="flex justify-between gap-3 pt-4">
          <OGDialog>
            <OGDialogTrigger asChild>
              {/* Deleting a project is not the main action of this dialog, so
                  it does not wear the filled red of one — that stays on the
                  confirmation below, where it IS the main action. Quiet text,
                  far from Save, is what the prototype draws and why. */}
              <Button
                variant="ghost"
                disabled={isBusy}
                className="gap-2 text-text-destructive hover:bg-surface-destructive-hover hover:text-white"
              >
                {deleteMutation.isLoading ? (
                  <Spinner />
                ) : (
                  <Trash2 className="icon-sm" aria-hidden="true" />
                )}
                {localize('com_projects_delete')}
              </Button>
            </OGDialogTrigger>
            <OGDialogTemplate
              title={localize('com_projects_delete')}
              className="max-w-[450px]"
              main={
                <Label className="text-left text-sm font-medium">
                  {localize('com_projects_delete_confirm', { name: project.name })}
                </Label>
              }
              selection={{
                selectHandler: handleDelete,
                selectClasses:
                  'bg-surface-destructive hover:bg-surface-destructive-hover text-white transition-colors',
                selectText: localize('com_projects_delete'),
              }}
            />
          </OGDialog>
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
