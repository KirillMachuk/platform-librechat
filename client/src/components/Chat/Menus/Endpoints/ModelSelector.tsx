import React, { useMemo, useState } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { EModelEndpoint, getConfigDefaults, isAgentsEndpoint } from 'librechat-data-provider';
import type { ModelSelectorProps } from '~/common';
import {
  SelectorTabs,
  EndpointModelItem,
  renderModelSpecs,
  renderSearchResults,
  renderCustomGroups,
  renderEndpointModels,
} from './components';
import type { SelectorTab } from './components';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import { ModelSelectorChatProvider } from './ModelSelectorChatContext';
import { getSelectedIcon, getDisplayValue } from './utils';
import { CustomMenu as Menu } from './CustomMenu';
import DialogManager from './DialogManager';
import { useLocalize } from '~/hooks';

const defaultInterface = getConfigDefaults().interface;

function ModelSelectorContent() {
  const localize = useLocalize();

  const {
    agentsMap,
    modelSpecs,
    mappedEndpoints,
    endpointsConfig,
    searchValue,
    searchResults,
    selectedValues,
    setSearchValue,
    setSelectedValues,
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();

  const [activeTab, setActiveTab] = useState<SelectorTab>(() =>
    isAgentsEndpoint(selectedValues.endpoint ?? '') ? 'agents' : 'llm',
  );

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig],
  );

  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        agentsMap,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, agentsMap, modelSpecs, selectedValues, mappedEndpoints],
  );

  const agentsEndpoint = useMemo(
    () => mappedEndpoints?.find((ep) => isAgentsEndpoint(ep.value)) ?? null,
    [mappedEndpoints],
  );

  const llmEndpoints = useMemo(
    () => mappedEndpoints?.filter((ep) => !isAgentsEndpoint(ep.value)) ?? [],
    [mappedEndpoints],
  );

  const agentModelSpecs = useMemo(
    () => modelSpecs?.filter((spec) => spec.group === EModelEndpoint.agents) ?? [],
    [modelSpecs],
  );

  const nonAgentModelSpecs = useMemo(
    () => modelSpecs?.filter((spec) => !spec.group) ?? [],
    [modelSpecs],
  );

  const agentSpecIds = useMemo(() => {
    const ids = new Set<string>();
    for (const spec of agentModelSpecs) {
      if (spec.preset?.agent_id) ids.add(spec.preset.agent_id);
    }
    return ids;
  }, [agentModelSpecs]);

  const agentsEndpointModels = useMemo(
    () => agentsEndpoint?.models?.filter((m) => !agentSpecIds.has(m.name)) ?? [],
    [agentsEndpoint, agentSpecIds],
  );

  const trigger = (
    <TooltipAnchor
      aria-label={localize('com_ui_select_model')}
      description={localize('com_ui_select_model')}
      render={
        <button
          className="my-1 flex h-9 w-full max-w-[70vw] items-center justify-center gap-2 rounded-xl border border-border-light bg-presentation px-3 py-2 text-sm text-text-primary hover:bg-surface-active-alt"
          aria-label={localize('com_ui_select_model')}
        >
          {selectedIcon && React.isValidElement(selectedIcon) && (
            <div className="flex flex-shrink-0 items-center justify-center overflow-hidden">
              {selectedIcon}
            </div>
          )}
          <span className="flex-grow truncate text-left">{selectedDisplayValue}</span>
        </button>
      }
    />
  );

  const renderAgentsTab = () => (
    <>
      {renderModelSpecs(agentModelSpecs, selectedValues.modelSpec || '')}
      {agentsEndpoint && renderEndpointModels(agentsEndpoint, agentsEndpointModels, undefined, 0)}
    </>
  );

  const renderLlmTab = () => (
    <>
      {renderModelSpecs(nonAgentModelSpecs, selectedValues.modelSpec || '')}
      {llmEndpoints.flatMap((endpoint) =>
        (endpoint.models ?? []).map((model) => (
          <EndpointModelItem
            key={`${endpoint.value}-${model.name}`}
            endpoint={endpoint}
            modelId={model.name}
          />
        )),
      )}
      {renderCustomGroups(modelSpecs || [], mappedEndpoints ?? [])}
    </>
  );

  const renderContent = () => {
    if (searchResults) {
      return renderSearchResults(searchResults, localize, searchValue);
    }
    if (activeTab === 'agents') {
      return renderAgentsTab();
    }
    return renderLlmTab();
  };

  return (
    <div className="relative flex w-full max-w-md flex-col items-center gap-2">
      <Menu
        values={selectedValues}
        onValuesChange={(values: Record<string, string>) => {
          setSelectedValues({
            endpoint: values.endpoint || '',
            model: values.model || '',
            modelSpec: values.modelSpec || '',
          });
        }}
        onSearch={(value) => setSearchValue(value)}
        combobox={<input id="model-search" placeholder=" " />}
        comboboxLabel={localize('com_endpoint_search_models')}
        trigger={trigger}
      >
        {!searchResults && (
          <SelectorTabs activeTab={activeTab} onTabChange={setActiveTab} />
        )}
        {renderContent()}
      </Menu>
      <DialogManager
        keyDialogOpen={keyDialogOpen}
        onOpenChange={onOpenChange}
        endpointsConfig={endpointsConfig || {}}
        keyDialogEndpoint={keyDialogEndpoint || undefined}
      />
    </div>
  );
}

export default function ModelSelector({ startupConfig }: ModelSelectorProps) {
  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  if (interfaceConfig.modelSelect === false && modelSpecs.length === 0) {
    return null;
  }

  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ModelSelectorContent />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
