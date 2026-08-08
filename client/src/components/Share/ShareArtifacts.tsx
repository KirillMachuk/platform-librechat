import { useState, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import {
  useMediaQuery,
  ResizablePanel,
  ResizableHandleAlt,
  ResizablePanelGroup,
} from '@librechat/client';
import type { TMessage } from 'librechat-data-provider';
import type { ArtifactsContextValue } from '~/Providers';
import { ArtifactsProvider, EditorProvider } from '~/Providers';
import Artifacts from '~/components/Artifacts/Artifacts';
import { isCodeOnlyArtifact } from '~/utils/artifacts';
import { getLatestText } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

const DEFAULT_ARTIFACT_PANEL_SIZE = 40;
const SHARE_ARTIFACT_PANEL_STORAGE_KEY = 'share:artifacts-panel-size';
const SHARE_ARTIFACT_PANEL_DEFAULT_KEY = 'share:artifacts-panel-size-default';

/**
 * Gets the initial artifact panel size from localStorage or returns default
 */
const getInitialArtifactPanelSize = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_ARTIFACT_PANEL_SIZE;
  }

  const defaultSizeString = String(DEFAULT_ARTIFACT_PANEL_SIZE);
  const storedDefault = window.localStorage.getItem(SHARE_ARTIFACT_PANEL_DEFAULT_KEY);

  if (storedDefault !== defaultSizeString) {
    window.localStorage.setItem(SHARE_ARTIFACT_PANEL_DEFAULT_KEY, defaultSizeString);
    window.localStorage.removeItem(SHARE_ARTIFACT_PANEL_STORAGE_KEY);
    return DEFAULT_ARTIFACT_PANEL_SIZE;
  }

  const stored = window.localStorage.getItem(SHARE_ARTIFACT_PANEL_STORAGE_KEY);
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? parsed : DEFAULT_ARTIFACT_PANEL_SIZE;
};

interface ShareArtifactsContainerProps {
  messages: TMessage[];
  conversationId: string;
  mainContent: React.ReactNode;
}

/**
 * Container component that manages artifact visibility and layout for shared conversations
 */
export function ShareArtifactsContainer({
  messages,
  conversationId,
  mainContent,
}: ShareArtifactsContainerProps) {
  const artifacts = useRecoilValue(store.artifactsState);
  const artifactsVisibility = useRecoilValue(store.artifactsVisibility);
  const currentArtifactId = useRecoilValue(store.currentArtifactId);
  const isSmallScreen = useMediaQuery('(max-width: 1023px)');
  const [artifactPanelSize, setArtifactPanelSize] = useState(getInitialArtifactPanelSize);

  const artifactsContextValue = useMemo<ArtifactsContextValue | null>(() => {
    const latestMessage =
      Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : null;

    if (!latestMessage) {
      return null;
    }

    const latestMessageText = getLatestText(latestMessage);

    return {
      isSubmitting: false,
      latestMessageId: latestMessage.messageId ?? null,
      latestMessageText,
      conversationId: conversationId ?? null,
    };
  }, [messages, conversationId]);

  const hasSelectedArtifact = currentArtifactId != null && artifacts?.[currentArtifactId] != null;
  const hasAutoOpenableArtifact = Object.values(artifacts ?? {}).some(
    (artifact) => artifact != null && !isCodeOnlyArtifact(artifact.type),
  );
  const shouldRenderArtifacts =
    artifactsVisibility === true &&
    artifactsContextValue != null &&
    (hasSelectedArtifact || hasAutoOpenableArtifact);

  const normalizedArtifactSize = Math.min(60, Math.max(20, artifactPanelSize));

  const handleLayoutChanged = (layout: Record<string, number | string>) => {
    const raw = layout['share-artifacts'];
    const newSize = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (!Number.isFinite(newSize)) {
      return;
    }
    setArtifactPanelSize(newSize);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SHARE_ARTIFACT_PANEL_STORAGE_KEY, newSize.toString());
    }
  };

  if (!shouldRenderArtifacts || !artifactsContextValue) {
    return <>{mainContent}</>;
  }

  if (isSmallScreen) {
    return (
      <>
        {mainContent}
        <ShareArtifactsOverlay contextValue={artifactsContextValue} />
      </>
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full w-full"
      onLayoutChanged={handleLayoutChanged}
    >
      <ResizablePanel
        defaultSize={`${100 - normalizedArtifactSize}`}
        minSize="35"
        id="share-content"
      >
        {mainContent}
      </ResizablePanel>
      {/* No className: a fill here would paint the 8px gap into a divider strip,
          which canon §4 does not draw. */}
      <ResizableHandleAlt withHandle />
      <ResizablePanel
        defaultSize={`${normalizedArtifactSize}`}
        minSize="20"
        maxSize="60"
        id="share-artifacts"
      >
        <ShareArtifactsPanel contextValue={artifactsContextValue} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

interface ShareArtifactsPanelProps {
  contextValue: ArtifactsContextValue;
}

/**
 * Panel that renders the artifacts UI within a resizable container
 */
function ShareArtifactsPanel({ contextValue }: ShareArtifactsPanelProps) {
  return (
    <ArtifactsProvider value={contextValue}>
      <EditorProvider>
        <div className="flex h-full w-full border-l border-border-light bg-surface-primary shadow-2xl">
          <Artifacts />
        </div>
      </EditorProvider>
    </ArtifactsProvider>
  );
}

/**
 * Mobile overlay that displays artifacts in a fixed position
 */
function ShareArtifactsOverlay({ contextValue }: ShareArtifactsPanelProps) {
  const localize = useLocalize();
  return (
    <div
      className="fixed inset-y-0 right-0 z-drawer flex w-full max-w-full sm:max-w-[420px]"
      role="complementary"
      aria-label={localize('com_ui_artifacts')}
    >
      <ShareArtifactsPanel contextValue={contextValue} />
    </div>
  );
}
