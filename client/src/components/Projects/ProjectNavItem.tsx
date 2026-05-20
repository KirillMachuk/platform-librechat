import { memo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TProject } from 'librechat-data-provider';
import { resolveIcon, resolveColor } from './iconOptions';
import { cn } from '~/utils';

type Props = {
  project: TProject;
};

function ProjectNavItem({ project }: Props) {
  const navigate = useNavigate();
  const { projectId: activeProjectId } = useParams<{ projectId?: string }>();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        navigate(`/p/${project.projectId}`);
      }
    },
    [navigate, project.projectId],
  );

  const isActive = activeProjectId === project.projectId;
  const Icon = resolveIcon(project.icon);
  const iconColor = resolveColor(project.color);

  return (
    <a
      href={`/p/${project.projectId}`}
      onClick={handleClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group relative flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-primary outline-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white',
        isActive
          ? 'bg-surface-active-alt before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:rounded-full before:bg-black dark:before:bg-white'
          : 'hover:bg-surface-active-alt',
      )}
    >
      <Icon
        className="h-5 w-5 flex-shrink-0"
        style={{ color: iconColor }}
        aria-hidden="true"
      />
      <span className="truncate">{project.name}</span>
    </a>
  );
}

export default memo(ProjectNavItem);
