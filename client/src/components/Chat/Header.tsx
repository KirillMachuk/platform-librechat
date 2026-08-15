import { memo, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { useMediaQuery, TooltipAnchor } from '@librechat/client';
import { getConfigDefaults, PermissionTypes, Permissions } from 'librechat-data-provider';
import { resolveIcon, resolveColor } from '~/components/Projects/iconOptions';
import { useGetProjectQuery, useGetStartupConfig } from '~/data-provider';
import ModelSelector from './Menus/Endpoints/ModelSelector';
import { useBookmarksEnabled, useHasAccess } from '~/hooks';
import ExportAndShareMenu from './ExportAndShareMenu';
import { OpenSidebar, PresetsMenu } from './Menus';
import { ChevronRight } from '~/components/icons';
import BookmarkMenu from './Menus/BookmarkMenu';
import { TemporaryChat } from './TemporaryChat';
import AddMultiConvo from './AddMultiConvo';
import { cn } from '~/utils';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

function Header() {
  const { data: startupConfig } = useGetStartupConfig();
  const navVisible = useRecoilValue(store.sidebarExpanded);
  const bookmarksEnabled = useBookmarksEnabled();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const projectId = conversation?.project_id;
  const { data: project } = useGetProjectQuery(projectId ?? '', {
    enabled: !!projectId,
  });

  const projectBadge = useMemo(() => {
    if (!project) return null;
    const Icon = resolveIcon(project.icon);
    const iconHex = resolveColor(project.color);
    return (
      <>
        <TooltipAnchor
          description={project.name}
          render={
            <div
              aria-label={project.name}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border-light"
              style={{ backgroundColor: `${iconHex}1a` }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: iconHex }} aria-hidden="true" />
            </div>
          }
        />
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
      </>
    );
  }, [project]);

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );

  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });

  const hasAccessToTemporaryChat = useHasAccess({
    permissionType: PermissionTypes.TEMPORARY_CHAT,
    permission: Permissions.USE,
  });

  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  /* Непрозрачная подложка, а не градиент: классы с прозрачностью
     (`via-presentation/70` и соседи) НЕ порождали CSS — цвет объявлен как
     `var(--presentation)` без плейсхолдера `<alpha-value>`, — поэтому шапка
     оставалась полупрозрачной на всех ширинах и лента печаталась сквозь неё
     по её же подписям (§7 «закон шапок»: контент под шапкой не виден).
     Высота по канону разная: §7 — 56 на телефоне, §4 — 52 на десктопе,
     чтобы селектор встал на одну ось с логотипом в сайдбаре. */
  return (
    <div className="absolute top-0 z-10 flex h-14 w-full items-center justify-between bg-presentation p-2 font-semibold text-text-primary md:h-[52px]">
      <div className="hide-scrollbar pan-x flex w-full items-center justify-between gap-2 overflow-x-auto">
        <div className="mx-1 flex items-center">
          {isSmallScreen ? <OpenSidebar /> : null}
          {!(navVisible && isSmallScreen) && (
            <div
              className={cn(
                'flex items-center gap-2 pl-2',
                !isSmallScreen ? 'transition-all duration-200 ease-in-out' : '',
              )}
            >
              {projectBadge}
              <ModelSelector startupConfig={startupConfig} />
              {interfaceConfig.presets === true && interfaceConfig.modelSelect && <PresetsMenu />}
              {bookmarksEnabled && <BookmarkMenu />}
              {hasAccessToMultiConvo === true && <AddMultiConvo />}
              {isSmallScreen && (
                <>
                  <ExportAndShareMenu
                    isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
                  />
                  {hasAccessToTemporaryChat === true && <TemporaryChat />}
                </>
              )}
            </div>
          )}
        </div>

        {!isSmallScreen && (
          <div className="flex items-center gap-2">
            <ExportAndShareMenu
              isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
            />
            {hasAccessToTemporaryChat === true && <TemporaryChat />}
          </div>
        )}
      </div>
      {/* Empty div for spacing */}
      <div />
    </div>
  );
}

const MemoizedHeader = memo(Header);
MemoizedHeader.displayName = 'Header';

export default MemoizedHeader;
