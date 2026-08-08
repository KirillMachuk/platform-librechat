import { useEffect, memo } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { ResizableHandleAlt, ResizablePanel } from '@librechat/client';

interface ArtifactsPanelProps {
  artifacts: React.ReactNode | null;
  cardClassName: string;
  minSizeMain: string;
  shouldRender: boolean;
  onRenderChange: (shouldRender: boolean) => void;
}

const ArtifactsPanel = memo(function ArtifactsPanel({
  artifacts,
  cardClassName,
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
      {artifacts != null && (
        /* Зазор между карточками И ЕСТЬ ручка: отдельной полосы прототип не
           рисует, поэтому дорожка прозрачная, а видимая засечка остаётся. */
        <ResizableHandleAlt withHandle className="w-2 bg-transparent text-text-secondary" />
      )}
      <ResizablePanel
        defaultSize="50"
        maxSize="70"
        collapsedSize="0"
        collapsible={true}
        minSize={minSizeMain}
        panelRef={artifactsPanelRef}
        id="artifacts-panel"
      >
        <div className={`min-w-[400px] ${cardClassName}`}>{artifacts}</div>
      </ResizablePanel>
    </>
  );
});

ArtifactsPanel.displayName = 'ArtifactsPanel';

export default ArtifactsPanel;
