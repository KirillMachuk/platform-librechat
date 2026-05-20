import { memo, useState } from 'react';
import { Plus, FolderPlus } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import { useListProjectsQuery } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';
import ProjectCreateDialog from './ProjectCreateDialog';
import ProjectNavItem from './ProjectNavItem';

function ProjectsSection() {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthContext();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: projects = [] } = useListProjectsQuery({
    enabled: isAuthenticated,
    staleTime: 60000,
  });

  return (
    <div className="flex flex-col gap-1 px-2 pt-2" role="region" aria-label={localize('com_projects_section')}>
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {localize('com_projects_section')}
        </span>
        <TooltipAnchor
          side="right"
          description={localize('com_projects_new')}
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={() => setCreateOpen(true)}
              aria-label={localize('com_projects_new')}
            >
              <Plus className="h-4 w-4 text-text-primary" aria-hidden="true" />
            </Button>
          }
        />
      </div>

      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-primary transition-colors hover:bg-surface-hover"
      >
        <FolderPlus className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <span className="truncate">{localize('com_projects_new')}</span>
      </button>

      {projects.map((project) => (
        <ProjectNavItem key={project.projectId} project={project} />
      ))}

      <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

export default memo(ProjectsSection);
