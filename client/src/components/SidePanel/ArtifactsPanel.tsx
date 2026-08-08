import { useEffect, memo } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { ResizableHandleAlt, ResizablePanel } from '@librechat/client';
import { PANEL_CARD } from './card';
import { cn } from '~/utils';

interface ArtifactsPanelProps {
  artifacts: React.ReactNode | null;
  minSizeMain: string;
  shouldRender: boolean;
  onRenderChange: (shouldRender: boolean) => void;
}

const ArtifactsPanel = memo(function ArtifactsPanel({
  artifacts,
  minSizeMain,
  shouldRender,
  onRenderChange,
}: ArtifactsPanelProps) {
  const artifactsPanelRef = usePanelRef();

  useEffect(() => {
    if (artifacts != null) {
      onRenderChange(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          artifactsPanelRef.current?.expand();
        });
      });
    } else if (shouldRender) {
      onRenderChange(false);
    }
  }, [artifacts, shouldRender, onRenderChange, artifactsPanelRef]);

  if (!shouldRender) {
    return null;
  }

  return (
    <>
      {/* No className: the canonical grip — 8px of bare canvas with a pill in
          the middle — is what `ResizableHandleAlt` draws by default. Painting a
          fill here would put the divider strip back. */}
      {artifacts != null && <ResizableHandleAlt withHandle />}
      <ResizablePanel
        defaultSize="50"
        maxSize="70"
        collapsedSize="0"
        collapsible={true}
        minSize={minSizeMain}
        panelRef={artifactsPanelRef}
        id="artifacts-panel"
      >
        <div className={cn('min-w-[400px]', PANEL_CARD)}>{artifacts}</div>
      </ResizablePanel>
    </>
  );
});

ArtifactsPanel.displayName = 'ArtifactsPanel';

export default ArtifactsPanel;
