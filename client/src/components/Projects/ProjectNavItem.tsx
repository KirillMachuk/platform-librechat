import { memo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Palette } from 'lucide-react';
import type { TProject } from 'librechat-data-provider';
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

  return (
    <a
      href={`/p/${project.projectId}`}
      onClick={handleClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-primary transition-colors hover:bg-surface-hover',
        isActive && 'bg-surface-hover',
      )}
    >
      <Palette className="h-5 w-5 flex-shrink-0 text-pink-500" aria-hidden="true" />
      <span className="truncate">{project.name}</span>
    </a>
  );
}

export default memo(ProjectNavItem);
