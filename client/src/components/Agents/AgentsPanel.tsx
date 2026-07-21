import { useState, useRef, useCallback, useMemo, memo } from 'react';
import { Button } from '@librechat/client';
import { Plus, ChevronLeft } from 'lucide-react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import { useGetAgentCategoriesQuery, useGetEndpointsQuery } from '~/data-provider';
import AgentPanelSwitch from '~/components/SidePanel/Agents/AgentPanelSwitch';
import { useLocalize, useHasAccess } from '~/hooks';
import CategoryTabs from './CategoryTabs';
import SearchBar from './SearchBar';
import AgentGrid from './AgentGrid';

function resolveCategoryLabel(
  category: string,
  categories: t.TMarketplaceCategory[] | undefined,
  topPicksLabel: string,
  allLabel: string,
): string {
  if (category === 'promoted') {
    return topPicksLabel;
  }
  if (category === 'all') {
    return allLabel;
  }
  const found = categories?.find((cat) => cat.value === category);
  return found?.label ?? category;
}

function CatalogView({
  onEditAgent,
  onStartChat,
}: {
  onEditAgent: (agent: t.Agent) => void;
  onStartChat?: () => void;
}) {
  const localize = useLocalize();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [displayCategory, setDisplayCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  useGetEndpointsQuery();

  /**
   * Same reason as the agent list: promoting an agent adds the "Top Picks" tab, but the
   * invalidation lands while this view is unmounted, so skipping the mount refetch left
   * the tab missing until the cache expired.
   */
  const categoriesQuery = useGetAgentCategoriesQuery({
    staleTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  /**
   * The server only includes the synthetic "promoted" tab when promoted agents
   * exist; defaulting to it unconditionally rendered an empty catalog. Fall back
   * to "all" until the user picks a tab.
   */
  const activeCategory = useMemo(() => {
    if (displayCategory !== null) {
      return displayCategory;
    }
    const hasPromoted = categoriesQuery.data?.some((cat) => cat.value === 'promoted') ?? false;
    return hasPromoted ? 'promoted' : 'all';
  }, [displayCategory, categoriesQuery.data]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query.trim());
  }, []);

  const handleTabChange = useCallback((tabValue: string) => {
    setDisplayCategory(tabValue);
  }, []);

  const topPicksLabel = localize('com_agents_top_picks');
  const allLabel = localize('com_agents_all');
  const headingLabel = useMemo(
    () => resolveCategoryLabel(activeCategory, categoriesQuery.data, topPicksLabel, allLabel),
    [activeCategory, categoriesQuery.data, topPicksLabel, allLabel],
  );

  return (
    <div
      ref={scrollContainerRef}
      className="scrollbar-gutter-stable relative flex h-full flex-col overflow-y-auto overflow-x-hidden"
    >
      <div className="sticky top-0 z-10 bg-background pb-3 pt-1">
        <div className="px-4">
          <div className="mb-3 flex gap-2">
            <SearchBar value={searchQuery} onSearch={handleSearch} />
          </div>
          <CategoryTabs
            categories={categoriesQuery.data || []}
            activeTab={activeCategory}
            isLoading={categoriesQuery.isLoading}
            onChange={handleTabChange}
          />
        </div>
      </div>
      <div className="px-4 pb-6">
        {!searchQuery && (
          <div className="mb-4 mt-4">
            <h2 className="text-xl font-bold text-text-primary">{headingLabel}</h2>
          </div>
        )}
        <AgentGrid
          key={`grid-${activeCategory}`}
          category={activeCategory}
          searchQuery={searchQuery}
          onEditAgent={onEditAgent}
          onStartChat={onStartChat}
          scrollElementRef={scrollContainerRef}
        />
      </div>
    </div>
  );
}

function AgentsPanel({ onClose }: { onClose?: () => void }) {
  const localize = useLocalize();
  /** `null` = catalog view; `''` = builder with a blank form; `agent_xxx` = builder editing that agent */
  const [builderTarget, setBuilderTarget] = useState<string | null>(null);
  const canCreateAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.CREATE,
  });

  const goNewAgent = useCallback(() => setBuilderTarget(''), []);
  const goCatalog = useCallback(() => setBuilderTarget(null), []);
  const handleEditAgent = useCallback((agent: t.Agent) => setBuilderTarget(agent.id), []);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-border-light px-4 py-2">
        {builderTarget === null ? (
          <>
            <span className="text-sm font-medium text-text-primary">
              {localize('com_ui_agents')}
            </span>
            {canCreateAgents && (
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3"
                onClick={goNewAgent}
                data-testid="agents-create-button"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{localize('com_ui_create_new_agent')}</span>
              </Button>
            )}
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-2 text-text-primary"
            onClick={goCatalog}
            data-testid="agents-back-button"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span>{localize('com_ui_agents')}</span>
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {builderTarget === null ? (
          <CatalogView onEditAgent={handleEditAgent} onStartChat={onClose} />
        ) : (
          <AgentPanelSwitch agentId={builderTarget} />
        )}
      </div>
    </div>
  );
}

export default memo(AgentsPanel);
