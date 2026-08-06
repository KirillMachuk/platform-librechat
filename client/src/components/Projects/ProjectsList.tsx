import { memo, useState } from 'react';
import { Plus, ChevronRight } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { PanelHeaderAction } from '~/components/UnifiedSidebar/PanelDialog';
import { resolveIcon, resolveColor } from './iconOptions';
import ProjectCreateDialog from './ProjectCreateDialog';
import { useListProjectsQuery } from '~/data-provider';
import { useLocalize, useAuthContext } from '~/hooks';

type Props = {
  onSelect: (projectId: string) => void;
};

function ProjectsList({ onSelect }: Props) {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthContext();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: projects = [], isLoading } = useListProjectsQuery({
    enabled: isAuthenticated,
    staleTime: 60000,
  });

  return (
    <div className="flex h-full w-full flex-col px-6 pb-6 pt-4">
      <PanelHeaderAction>
        <Button variant="submit" onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="icon-sm" aria-hidden="true" />
          <span>{localize('com_projects_new')}</span>
        </Button>
      </PanelHeaderAction>

      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}

      {/* The action lives in the header now, so an empty screen says what a
          project is for instead of repeating the same button in a dashed box. */}
      {!isLoading && projects.length === 0 && (
        <p className="flex flex-1 items-center justify-center px-8 text-center text-sm text-text-secondary">
          {localize('com_projects_empty')}
        </p>
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
                  className="group flex w-full items-center gap-3 rounded-xl px-[10px] py-2 text-left transition-colors duration-90 hover:bg-surface-hover"
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${iconColor}1a` }}
                  >
                    <Icon className="icon-md" style={{ color: iconColor }} aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-text-primary">{project.name}</span>
                    <span className="truncate text-[12.5px] text-text-secondary">
                      {/* `n` rather than `count`: the latter switches i18next
                          to plural lookup, and this product has no plural
                          keys — a label with a colon reads right at any
                          number in both languages.
                          A project with nothing in it says so once, rather
                          than showing a row of zeroes. */}
                      {(project.conversationCount ?? 0) + (project.fileCount ?? 0) === 0
                        ? localize('com_projects_meta_empty')
                        : `${localize('com_projects_meta_chats', {
                            n: project.conversationCount ?? 0,
                          })} · ${localize('com_projects_meta_sources', {
                            n: project.fileCount ?? 0,
                          })}`}
                    </span>
                  </span>
                  <ChevronRight
                    className="icon-sm flex-shrink-0 text-text-tertiary"
                    aria-hidden="true"
                  />
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
