import { useState, useEffect, memo } from 'react';
import { useSetRecoilState } from 'recoil';
import { useDefaultLayout } from 'react-resizable-panels';
import { ResizablePanel, ResizablePanelGroup, useMediaQuery } from '@librechat/client';
import ArtifactsPanel from './ArtifactsPanel';
import { PANEL_CARD } from './card';
import { cn } from '~/utils';
import store from '~/store';

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
  /* On a phone the panel is a full-screen overlay, not a column, so there is no
     frame to split and the group keeps painting the single card's fill. */
  const split = artifacts != null && !isSmallScreen;

  /* The layers above this one have to stop painting for the gap between the
     cards to show canvas, and only this component knows both halves of the
     answer. It is published for the length of the mount so that leaving the
     chat puts the frame back, whatever the artifact atoms still hold. */
  const setFrameSplit = useSetRecoilState(store.artifactsFrameSplit);
  useEffect(() => {
    setFrameSplit(split);
    return () => setFrameSplit(false);
  }, [split, setFrameSplit]);

  return (
    <>
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className={cn('relative flex-1', split ? 'bg-transparent' : 'bg-presentation')}
      >
        <ResizablePanel defaultSize="50" minSize={minSizeMain} id="messages-view">
          {split ? <div className={PANEL_CARD}>{children}</div> : children}
        </ResizablePanel>

        {!isSmallScreen && (
          <ArtifactsPanel
            artifacts={artifacts}
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
