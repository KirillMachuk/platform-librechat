import { memo, useCallback, useState } from 'react';
import ProjectDetailView from './ProjectDetailView';
import ProjectsList from './ProjectsList';

type Props = {
  onClose?: () => void;
};

function ProjectsPanel({ onClose }: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const handleBack = useCallback(() => setSelectedProjectId(null), []);
  const handleClose = useCallback(() => onClose?.(), [onClose]);

  if (selectedProjectId === null) {
    return <ProjectsList onSelect={setSelectedProjectId} />;
  }

  return (
    <ProjectDetailView projectId={selectedProjectId} onBack={handleBack} onClose={handleClose} />
  );
}

export default memo(ProjectsPanel);
