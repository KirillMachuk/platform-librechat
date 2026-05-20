import { memo, useState } from 'react';
import { Plus, FolderPlus } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { useListProjectsQuery } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';
import ProjectCreateDialog from './ProjectCreateDialog';
import { resolveIcon, resolveColor } from './iconOptions';

type Props = {
  onSelect: (projectId: string) => void;
};

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

function ProjectsList({ onSelect }: Props) {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthContext();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: projects = [], isLoading } = useListProjectsQuery({
    enabled: isAuthenticated,
    staleTime: 60000,
  });

  return (
    <div className="flex h-full w-full flex-col px-6 py-6">
      <div className="flex items-center justify-end pb-4">
        <Button
          variant="default"
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-2"
          aria-label={localize('com_projects_new')}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{localize('com_projects_new')}</span>
        </Button>
      </div>

      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!isLoading && projects.length === 0 && (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-light p-8 text-text-secondary transition-colors hover:bg-surface-hover"
        >
          <FolderPlus className="h-8 w-8" aria-hidden="true" />
          <span className="text-sm">{localize('com_projects_new')}</span>
        </button>
      )}

      {!isLoading && projects.length > 0 && (
        <ul className="flex flex-col">
          {projects.map((project) => {
            const Icon = resolveIcon(project.icon);
            const iconColor = resolveColor(project.color);
            return (
              <li key={project.projectId}>
                <button
                  type="button"
                  onClick={() => onSelect(project.projectId)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${iconColor}1a` }}
                    >
                      <Icon className="h-5 w-5" style={{ color: iconColor }} aria-hidden="true" />
                    </span>
                    <span className="truncate text-sm text-text-primary">{project.name}</span>
                  </div>
                  <span className="flex-shrink-0 text-xs text-text-secondary">
                    {formatDate(project.updatedAt ?? project.createdAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(project) => onSelect(project.projectId)}
      />
    </div>
  );
}

export default memo(ProjectsList);
