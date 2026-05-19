import { useState, useRef, useCallback, memo } from 'react';
import { Plus, ChevronLeft } from 'lucide-react';
import { Button } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type t from 'librechat-data-provider';
import { useGetAgentCategoriesQuery, useGetEndpointsQuery } from '~/data-provider';
import AgentPanelSwitch from '~/components/SidePanel/Agents/AgentPanelSwitch';
import { useLocalize, useHasAccess } from '~/hooks';
import CategoryTabs from './CategoryTabs';
import SearchBar from './SearchBar';
import AgentGrid from './AgentGrid';
import { cn } from '~/utils';

type View = 'catalog' | 'builder';

function CatalogView() {
  const localize = useLocalize();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [displayCategory, setDisplayCategory] = useState<string>('promoted');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useGetEndpointsQuery();

  const categoriesQuery = useGetAgentCategoriesQuery({
    staleTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const handleAgentSelect = useCallback((_agent: t.Agent) => {
    // AgentCard opens AgentDetailContent dialog internally; nothing else needed.
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query.trim());
  }, []);

  const handleTabChange = useCallback((tabValue: string) => {
    setDisplayCategory(tabValue);
  }, []);

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
            activeTab={displayCategory}
            isLoading={categoriesQuery.isLoading}
            onChange={handleTabChange}
          />
        </div>
      </div>
      <div className="px-4 pb-6">
        {!searchQuery && (
          <div className="mb-4 mt-4">
            <h2 className="text-xl font-bold text-text-primary">
              {displayCategory === 'promoted'
                ? localize('com_agents_top_picks')
                : displayCategory === 'all'
                  ? localize('com_agents_all')
                  : (categoriesQuery.data?.find((cat) => cat.value === displayCategory)?.label ??
                    displayCategory)}
            </h2>
          </div>
        )}
        <AgentGrid
          key={`grid-${displayCategory}`}
          category={displayCategory}
          searchQuery={searchQuery}
          onSelectAgent={handleAgentSelect}
          scrollElementRef={scrollContainerRef}
        />
      </div>
    </div>
  );
}

function AgentsPanel() {
  const localize = useLocalize();
  const [view, setView] = useState<View>('catalog');
  const canCreateAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.CREATE,
  });

  const goBuilder = useCallback(() => setView('builder'), []);
  const goCatalog = useCallback(() => setView('catalog'), []);

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className={cn(
          'flex items-center justify-between border-b border-border-light px-4 py-2',
        )}
      >
        {view === 'catalog' ? (
          <>
            <span className="text-sm font-medium text-text-primary">
              {localize('com_ui_agents')}
            </span>
            {canCreateAgents && (
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3"
                onClick={goBuilder}
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
        {view === 'catalog' ? <CatalogView /> : <AgentPanelSwitch />}
      </div>
    </div>
  );
}

export default memo(AgentsPanel);
