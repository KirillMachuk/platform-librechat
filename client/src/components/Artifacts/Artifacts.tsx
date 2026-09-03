import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import copy from 'copy-to-clipboard';
import * as Tabs from '@radix-ui/react-tabs';
import { useSetRecoilState, useResetRecoilState } from 'recoil';
import { Button, Spinner, useMediaQuery, Radio } from '@librechat/client';
import { getVerifiedPresentationPreviewAsset } from 'librechat-data-provider';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react';
import {
  isCodeOnlyArtifact,
  isFilePreviewArtifact,
  isGoogleWorkspacePreviewArtifact,
  isPreviewOnlyArtifact,
  TOOL_ARTIFACT_TYPES,
} from '~/utils/artifacts';
import { GOOGLE_FILE_LOCALIZATION_KEYS, validateGoogleWorkspaceFile } from '~/utils/google';
import { displayFilename } from '~/components/Chat/Messages/Content/Parts/attachmentTypes';
import { Code, ExternalLink, Play, Reload, X } from '~/components/icons';
import VerifiedPresentationPreview from './VerifiedPresentationPreview';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { useShareContext, useMutationState } from '~/Providers';
import GoogleWorkspacePreview from './GoogleWorkspacePreview';
import ArtifactQualitySummary from './ArtifactQualitySummary';
import useArtifacts from '~/hooks/Artifacts/useArtifacts';
import DownloadArtifact from './DownloadArtifact';
import ArtifactVersion from './ArtifactVersion';
import FilePreviewBody from './FilePreviewBody';
import ArtifactTabs from './ArtifactTabs';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

const MAX_BLUR_AMOUNT = 32;
const MAX_BACKDROP_OPACITY = 0.3;

export default function Artifacts() {
  const localize = useLocalize();
  const { isMutating } = useMutationState();
  const { isSharedConvo } = useShareContext();
  const isMobile = useMediaQuery('(max-width: 767.98px)');
  const previewRef = useRef<SandpackPreviewRef>();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [presentationPreviewRevision, setPresentationPreviewRevision] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [height, setHeight] = useState(90);
  const [isDragging, setIsDragging] = useState(false);
  const [blurAmount, setBlurAmount] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(90);
  const setArtifactsVisible = useSetRecoilState(store.artifactsVisibility);
  const resetCurrentArtifactId = useResetRecoilState(store.currentArtifactId);

  const allTabOptions = useMemo(
    () => [
      {
        value: 'code',
        label: localize('com_ui_code'),
        icon: <Code className="size-4" />,
      },
      {
        value: 'preview',
        label: localize('com_ui_preview'),
        icon: <Play className="size-4" />,
      },
    ],
    [localize],
  );

  useEffect(() => {
    setIsMounted(true);
    const delay = isMobile ? 50 : 30;
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => {
      clearTimeout(timer);
      setIsMounted(false);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) {
      setBlurAmount(0);
      return;
    }

    const minHeightForBlur = 50;
    const maxHeightForBlur = 100;

    if (height <= minHeightForBlur) {
      setBlurAmount(0);
    } else if (height >= maxHeightForBlur) {
      setBlurAmount(MAX_BLUR_AMOUNT);
    } else {
      const progress = (height - minHeightForBlur) / (maxHeightForBlur - minHeightForBlur);
      setBlurAmount(Math.round(progress * MAX_BLUR_AMOUNT));
    }
  }, [height, isMobile]);

  const {
    activeTab,
    setActiveTab,
    currentIndex,
    currentArtifact,
    orderedArtifactIds,
    setCurrentArtifactId,
  } = useArtifacts();

  /* Office artifacts have no source view, and source-code artifacts have
   * no useful rendered preview. Filter each down to the only meaningful
   * tab and label that tab with the file name instead of generic
   * "Code" / "Preview" choices. */
  const isPreviewOnly = isPreviewOnlyArtifact(currentArtifact?.type);
  const isCodeOnly = isCodeOnlyArtifact(currentArtifact?.type);
  const isFilePreview = isFilePreviewArtifact(currentArtifact?.type);
  const isGoogleWorkspacePreview = isGoogleWorkspacePreviewArtifact(currentArtifact?.type);
  const googleWorkspaceFile = currentArtifact?.googleWorkspace;
  const validatedGoogleWorkspace = validateGoogleWorkspaceFile(googleWorkspaceFile);
  let constrainedTab: 'preview' | 'code' | null = null;
  if (isPreviewOnly || isFilePreview || isGoogleWorkspacePreview) {
    constrainedTab = 'preview';
  } else if (isCodeOnly) {
    constrainedTab = 'code';
  }
  const displayedTab = constrainedTab ?? activeTab;
  const tabOptions = useMemo(() => {
    if (constrainedTab == null) {
      return allTabOptions;
    }
    const filename = displayFilename(currentArtifact?.title);
    const tab = allTabOptions.find((opt) => opt.value === constrainedTab);
    if (!tab) {
      return allTabOptions;
    }
    return [filename ? { ...tab, label: filename } : tab];
  }, [allTabOptions, constrainedTab, currentArtifact?.title]);
  useEffect(() => {
    if (constrainedTab != null && activeTab !== constrainedTab) {
      setActiveTab(constrainedTab);
    }
  }, [constrainedTab, activeTab, setActiveTab]);

  const handleCopyArtifact = useCallback(() => {
    const content = currentArtifact?.content ?? '';
    if (!content) {
      return;
    }
    copy(content, { format: 'text/plain' });
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 3000);
  }, [currentArtifact?.content]);

  const handleDragStart = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (!isDragging) {
      return;
    }

    const deltaY = dragStartY.current - e.clientY;
    const viewportHeight = window.innerHeight;
    const deltaPercentage = (deltaY / viewportHeight) * 100;
    const newHeight = Math.max(10, Math.min(100, dragStartHeight.current + deltaPercentage));

    setHeight(newHeight);
  };

  const handleDragEnd = (e: React.PointerEvent) => {
    if (!isDragging) {
      return;
    }

    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // Snap to positions based on final height
    if (height < 30) {
      closeArtifacts();
    } else if (height > 95) {
      setHeight(100);
    } else if (height < 60) {
      setHeight(50);
    } else {
      setHeight(90);
    }
  };

  const closeArtifactsRef = useRef<(() => void) | null>(null);
  /* Escape закрывает панель, только когда над ней НЕТ ни одного видимого
     слоя (17.08, ревью + e2e): порядок слушателей не годится (Radix
     регистрируется позже и его preventDefault опаздывает, Ariakit его не
     зовёт вовсе), фокус не годится (Radix возвращает его триггеру ПОЗЖЕ
     любого нашего focus()). Проверка «есть ли слой» — по самому DOM в момент
     нажатия: открытый слой ещё смонтирован, когда наш bubble-слушатель
     срабатывает первым. Поля ввода и IME-набор не трогаем. */
  useEffect(() => {
    const LAYER_SELECTOR =
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [aria-modal="true"]';
    const hasVisibleLayer = () =>
      Array.from(document.querySelectorAll(LAYER_SELECTOR)).some(
        (el) => (el as HTMLElement).getClientRects().length > 0,
      );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }
      if (hasVisibleLayer()) {
        return;
      }
      closeArtifactsRef.current?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!currentArtifact || !isMounted) {
    return null;
  }

  const handleRefresh = () => {
    setIsRefreshing(true);
    setPresentationPreviewRevision((revision) => revision + 1);
    const client = previewRef.current?.getClient();
    if (client) {
      client.dispatch({ type: 'refresh' });
    }
    setTimeout(() => setIsRefreshing(false), 750);
  };

  const closeArtifacts = () => {
    if (isMobile) {
      setIsClosing(true);
      setIsVisible(false);
      setTimeout(() => {
        setArtifactsVisible(false);
        setIsClosing(false);
        setHeight(90);
      }, 250);
    } else {
      resetCurrentArtifactId();
      setArtifactsVisible(false);
    }
  };
  closeArtifactsRef.current = closeArtifacts;

  const backdropOpacity =
    blurAmount > 0
      ? (Math.min(blurAmount, MAX_BLUR_AMOUNT) / MAX_BLUR_AMOUNT) * MAX_BACKDROP_OPACITY
      : 0;
  const mobileHeaderAlignment = isGoogleWorkspacePreview ? 'justify-between' : 'justify-center';
  // `vh` includes Safari's retractable browser chrome and can push a full-screen header off-screen.
  const mobilePanelHeight = isGoogleWorkspacePreview ? '100dvh' : `${height}vh`;
  const verifiedPresentationPreview =
    currentArtifact.type === TOOL_ARTIFACT_TYPES.PRESENTATION
      ? getVerifiedPresentationPreviewAsset(currentArtifact.file?.artifactReport)
      : undefined;
  const legacyArtifactPreview = (
    <ArtifactTabs
      artifact={currentArtifact}
      previewRef={previewRef as React.MutableRefObject<SandpackPreviewRef>}
      isSharedConvo={isSharedConvo}
    />
  );
  let previewBody: React.ReactNode;
  if (isFilePreview) {
    previewBody = <FilePreviewBody artifact={currentArtifact} />;
  } else if (isGoogleWorkspacePreview) {
    previewBody = <GoogleWorkspacePreview artifact={currentArtifact} isMobile={isMobile} />;
  } else if (verifiedPresentationPreview?.filepath) {
    previewBody = (
      <VerifiedPresentationPreview
        url={verifiedPresentationPreview.filepath}
        title={displayFilename(currentArtifact.title)}
        refreshKey={presentationPreviewRevision}
        fallback={<FilePreviewBody artifact={currentArtifact} />}
      />
    );
  } else {
    previewBody = legacyArtifactPreview;
  }

  return (
    <Tabs.Root value={displayedTab} onValueChange={setActiveTab} asChild>
      <div className="flex h-full w-full flex-col">
        {/* Mobile backdrop with dynamic blur */}
        {isMobile && (
          <div
            className={cn(
              'fixed inset-0 z-scrim-drawer bg-black will-change-[opacity,backdrop-filter]',
              isVisible && !isClosing
                ? 'transition-all duration-300'
                : 'pointer-events-none opacity-0 backdrop-blur-none transition-opacity duration-150',
              blurAmount < 8 && isVisible && !isClosing ? 'pointer-events-none' : '',
            )}
            style={{
              opacity: isVisible && !isClosing ? backdropOpacity : 0,
              backdropFilter: isVisible && !isClosing ? `blur(${blurAmount}px)` : 'none',
              WebkitBackdropFilter: isVisible && !isClosing ? `blur(${blurAmount}px)` : 'none',
            }}
            onClick={blurAmount >= 8 ? closeArtifacts : undefined}
            aria-hidden="true"
          />
        )}
        <div
          className={cn(
            'flex w-full flex-col bg-surface-primary text-xl text-text-primary',
            isMobile
              ? cn(
                  'fixed inset-x-0 bottom-0 z-drawer shadow-lg',
                  isGoogleWorkspacePreview ? 'rounded-none' : 'rounded-t-[20px]',
                  isVisible && !isClosing
                    ? 'translate-y-0 opacity-100'
                    : 'duration-250 translate-y-full opacity-0 transition-all',
                  isDragging ? '' : 'transition-all duration-300',
                )
              : cn(
                  'h-full shadow-lg',
                  isVisible && !isClosing
                    ? 'duration-350 translate-x-0 opacity-100 transition-all'
                    : 'translate-x-5 opacity-0 transition-all duration-300',
                ),
          )}
          style={isMobile ? { height: mobilePanelHeight } : { overflow: 'hidden' }}
        >
          {isMobile && !isGoogleWorkspacePreview && (
            <div
              className="flex flex-shrink-0 cursor-grab items-center justify-center bg-surface-primary-alt pb-1.5 pt-2.5 active:cursor-grabbing"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
            >
              <div className="h-1 w-12 rounded-full bg-border-xheavy opacity-40 transition-all duration-200 active:opacity-60" />
            </div>
          )}

          {/* Header */}
          <div
            className={cn(
              'flex h-[52px] flex-shrink-0 items-center justify-between gap-2 border-b border-border-light bg-surface-primary-alt p-2 transition-all duration-300',
              isMobile ? mobileHeaderAlignment : 'overflow-hidden',
            )}
          >
            {!isMobile && !isGoogleWorkspacePreview && (
              <div
                className={cn(
                  'flex items-center transition-all duration-500',
                  isVisible && !isClosing
                    ? 'translate-x-0 opacity-100'
                    : '-translate-x-2 opacity-0',
                )}
              >
                <Radio
                  options={tabOptions}
                  value={displayedTab}
                  onChange={setActiveTab}
                  disabled={isMutating && displayedTab !== 'code'}
                  buttonClassName="h-9 px-3 gap-1.5"
                />
              </div>
            )}

            {isGoogleWorkspacePreview && (
              <div className="min-w-0 flex-1 truncate px-2 text-sm font-medium">
                {displayFilename(currentArtifact.title)}
              </div>
            )}

            <div
              className={cn(
                'flex items-center gap-2 transition-all duration-500',
                isMobile ? 'min-w-max' : '',
                isVisible && !isClosing ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0',
              )}
            >
              {displayedTab === 'preview' && !isFilePreview && !isGoogleWorkspacePreview && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  aria-label={localize('com_ui_refresh')}
                >
                  {isRefreshing ? (
                    <Spinner size={16} />
                  ) : (
                    <Reload
                      size={16}
                      className="transition-transform duration-200"
                      aria-hidden="true"
                    />
                  )}
                </Button>
              )}
              {displayedTab !== 'preview' && isMutating && (
                <Reload size={16} className="animate-spin text-text-secondary" />
              )}
              {orderedArtifactIds.length > 1 && (
                <ArtifactVersion
                  currentIndex={currentIndex}
                  totalVersions={orderedArtifactIds.length}
                  onVersionChange={(index) => {
                    const target = orderedArtifactIds[index];
                    if (target) {
                      setCurrentArtifactId(target);
                    }
                  }}
                />
              )}
              {!isFilePreview && !isGoogleWorkspacePreview && (
                <CopyButton isCopied={isCopied} iconOnly onClick={handleCopyArtifact} />
              )}
              {!isGoogleWorkspacePreview && <DownloadArtifact artifact={currentArtifact} />}
              {isGoogleWorkspacePreview && validatedGoogleWorkspace && googleWorkspaceFile && (
                <Button
                  size={isMobile ? 'icon' : 'sm'}
                  variant="ghost"
                  className={cn('h-9', isMobile ? 'w-9' : 'gap-1.5 px-2')}
                  asChild
                >
                  <a
                    href={validatedGoogleWorkspace.viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={localize(
                      GOOGLE_FILE_LOCALIZATION_KEYS[googleWorkspaceFile.kind].openAction,
                    )}
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    {!isMobile && (
                      <span>
                        {localize(
                          GOOGLE_FILE_LOCALIZATION_KEYS[googleWorkspaceFile.kind].openAction,
                        )}
                      </span>
                    )}
                  </a>
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={closeArtifacts}
                aria-label={localize('com_ui_close')}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-primary">
            <div className="absolute inset-0 flex flex-col">
              <ArtifactQualitySummary artifact={currentArtifact} />
              <div className="min-h-0 flex-1">{previewBody}</div>
            </div>

            <div
              className={cn(
                'absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm transition-opacity duration-300 ease-in-out',
                isRefreshing ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
              )}
              aria-hidden={!isRefreshing}
              role="status"
            >
              <div
                className={cn(
                  'transition-transform duration-300 ease-in-out',
                  isRefreshing ? 'scale-100' : 'scale-95',
                )}
              >
                <Spinner size={24} />
              </div>
            </div>
          </div>

          {isMobile && !isGoogleWorkspacePreview && (
            <div className="flex-shrink-0 border-t border-border-light bg-surface-primary-alt p-2">
              <Radio
                fullWidth
                options={tabOptions}
                value={displayedTab}
                onChange={setActiveTab}
                disabled={isMutating && displayedTab !== 'code'}
              />
            </div>
          )}
        </div>
      </div>
    </Tabs.Root>
  );
}
