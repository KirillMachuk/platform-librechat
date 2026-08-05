import { useState, memo } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizablePanel, ResizablePanelGroup, useMediaQuery } from '@librechat/client';
import ArtifactsPanel from './ArtifactsPanel';
import { cn } from '~/utils';

const PANEL_IDS_SINGLE = ['messages-view'];
const PANEL_IDS_SPLIT = ['messages-view', 'artifacts-panel'];

interface SidePanelProps {
  artifacts?: React.ReactNode;
  children: React.ReactNode;
}

const SidePanelGroup = memo(({ artifacts, children }: SidePanelProps) => {
  const [shouldRenderArtifacts, setShouldRenderArtifacts] = useState(artifacts != null);
  const isSmallScreen = useMediaQuery('(max-width: 767.98px)');

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'side-panel-layout',
    panelIds: artifacts != null ? PANEL_IDS_SPLIT : PANEL_IDS_SINGLE,
    storage: localStorage,
  });

  const minSizeMain = artifacts != null ? '15' : '30';
  /* Канон §4: с открытой панелью чат и панель — ДВЕ карточки, а зазор между
     ними и есть ручка перетаскивания. Тогда полотно между ними должно быть
     видно, поэтому группа не красится, а рамку и фон несут сами панели.
     На телефоне панель уходит в оверлей — там рамы нет. */
  const split = artifacts != null && !isSmallScreen;
  const cardClassName =
    'h-full overflow-hidden rounded-2xl border border-border-light bg-presentation shadow-sm';

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className={cn('relative flex-1', split ? 'bg-transparent' : 'bg-presentation')}
      >
        <ResizablePanel defaultSize="50" minSize={minSizeMain} id="messages-view">
          {split ? <div className={cardClassName}>{children}</div> : children}
        </ResizablePanel>

        {!isSmallScreen && (
          <ArtifactsPanel
            artifacts={artifacts}
            cardClassName={cardClassName}
            minSizeMain={minSizeMain}
            shouldRender={shouldRenderArtifacts}
            onRenderChange={setShouldRenderArtifacts}
          />
        )}
      </ResizablePanelGroup>
      {artifacts != null && isSmallScreen && (
        <div className="fixed inset-0 z-scrim-drawer">{artifacts}</div>
      )}
    </>
  );
});

SidePanelGroup.displayName = 'SidePanelGroup';

export default SidePanelGroup;
