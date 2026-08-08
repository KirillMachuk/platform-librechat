import { useState, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { Outlet } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import {
  PromptGroupsProvider,
  AssistantsMapContext,
  AgentsMapContext,
  SetConvoProvider,
  FileMapContext,
} from '~/Providers';
import {
  useSyncPreferences,
  useSearchEnabled,
  useAssistantsMap,
  useAuthContext,
  useAgentsMap,
  useFileMap,
} from '~/hooks';
import useArtifactsPanelOpen from '~/hooks/Artifacts/useArtifactsPanelOpen';
import { useUserTermsQuery, useGetStartupConfig } from '~/data-provider';
import { UnifiedSidebar } from '~/components/UnifiedSidebar';
import { TermsAndConditionsModal } from '~/components/ui';
import { useHealthCheck } from '~/data-provider';
import { Banner } from '~/components/Banners';
import { cn } from '~/utils';
import store from '~/store';

export default function Root() {
  const [showTerms, setShowTerms] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const panelOpen = useArtifactsPanelOpen();

  const { isAuthenticated, logout } = useAuthContext();

  useHealthCheck(isAuthenticated);
  useSyncPreferences(isAuthenticated);

  const assistantsMap = useAssistantsMap({ isAuthenticated });
  const agentsMap = useAgentsMap({ isAuthenticated });
  const fileMap = useFileMap({ isAuthenticated });

  const { data: config } = useGetStartupConfig();
  const { data: termsData } = useUserTermsQuery({
    enabled: isAuthenticated && config?.interface?.termsOfService?.modalAcceptance === true,
  });

  useSearchEnabled(isAuthenticated);

  useEffect(() => {
    if (termsData) {
      setShowTerms(!termsData.termsAccepted);
    }
  }, [termsData]);

  const handleAcceptTerms = () => {
    setShowTerms(false);
  };

  const handleDeclineTerms = () => {
    setShowTerms(false);
    logout('/login?redirect=false');
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SetConvoProvider>
      <FileMapContext.Provider value={fileMap}>
        <AssistantsMapContext.Provider value={assistantsMap}>
          <AgentsMapContext.Provider value={agentsMap}>
            <PromptGroupsProvider>
              <Banner onHeightChange={setBannerHeight} />
              <div className="flex" style={{ height: `calc(100dvh - ${bannerHeight}px)` }}>
                {/* Канон §4, врезанный сайдбар: полотно окна красится в `panel`,
                    сайдбар прозрачен и без правой границы, а рабочая область —
                    отдельная карточка `bg` с рамкой, радиусом 16 и отступом 8
                    сверху, справа и снизу. Слева отступа нет — там сайдбар.
                    На телефоне рамы нет: рабочая область занимает весь экран. */}
                <div className="relative z-0 flex h-full w-full overflow-hidden bg-surface-primary-alt">
                  <UnifiedSidebar />
                  <div
                    className={cn(
                      'relative flex h-full max-w-full flex-1 flex-col overflow-hidden md:my-2 md:mr-2 md:h-[calc(100%-1rem)]',
                      /* С открытой правой панелью карточек ДВЕ (прототип: чат и
                         панель — отдельные карточки, а зазор между ними и есть
                         ручка перетаскивания). Тогда общий контейнер держит
                         только отступы, а рамку и фон несут сами панели. */
                      !panelOpen &&
                        'md:rounded-2xl md:border md:border-border-light md:bg-presentation md:shadow-sm',
                    )}
                    style={{
                      transform: isSmallScreen && sidebarExpanded ? 'translateX(72vw)' : 'none',
                      transition: 'transform 300ms cubic-bezier(0.2, 0, 0, 1)',
                    }}
                    inert={isSmallScreen && sidebarExpanded ? '' : undefined}
                  >
                    <Outlet />
                  </div>
                </div>
              </div>
            </PromptGroupsProvider>
          </AgentsMapContext.Provider>
          {config?.interface?.termsOfService?.modalAcceptance === true && (
            <TermsAndConditionsModal
              open={showTerms}
              onOpenChange={setShowTerms}
              onAccept={handleAcceptTerms}
              onDecline={handleDeclineTerms}
              title={config.interface.termsOfService.modalTitle}
              modalContent={config.interface.termsOfService.modalContent}
            />
          )}
        </AssistantsMapContext.Provider>
      </FileMapContext.Provider>
    </SetConvoProvider>
  );
}
