import { useMemo } from 'react';
import { X } from 'lucide-react';
import { isAgentsEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import { modelDisplayName } from '~/components/Chat/Menus/Endpoints/utils';
import { useGetEndpointsQuery } from '~/data-provider';
import { EndpointIcon } from '~/components/Endpoints';
import { useAgentsMapContext } from '~/Providers';
import { useLocalize } from '~/hooks';

export default function AddedConvo({
  addedConvo,
  setAddedConvo,
}: {
  addedConvo: TConversation | null;
  setAddedConvo: SetterOrUpdater<TConversation | null>;
}) {
  const localize = useLocalize();
  const agentsMap = useAgentsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const title = useMemo(() => {
    /**
     * The whole point of a second conversation is comparing it against the first,
     * so name what differs — the model. An endpoint's modelDisplayLabel is the same
     * string for every model it serves, which reads as if the picker did nothing.
     * Priority: agent name > modelLabel > model > modelDisplayLabel
     */
    if (isAgentsEndpoint(addedConvo?.endpoint) && addedConvo?.agent_id) {
      const agent = agentsMap?.[addedConvo.agent_id];
      if (agent?.name) {
        return `+ ${agent.name}`;
      }
    }

    const endpointConfig = endpointsConfig?.[addedConvo?.endpoint ?? ''];
    const model = addedConvo?.model
      ? modelDisplayName(addedConvo.model, endpointsConfig, addedConvo.endpoint)
      : undefined;
    const displayLabel =
      addedConvo?.modelLabel || model || endpointConfig?.modelDisplayLabel || 'AI';

    return `+ ${displayLabel}`;
  }, [addedConvo, agentsMap, endpointsConfig]);

  if (!addedConvo) {
    return null;
  }
  return (
    <div className="flex items-start gap-4 py-2.5 pl-3 pr-1.5 text-sm">
      <span className="mt-0 flex h-6 w-6 flex-shrink-0 items-center justify-center">
        <div className="icon-md">
          <EndpointIcon
            conversation={addedConvo}
            endpointsConfig={endpointsConfig}
            agentsMap={agentsMap}
            containerClassName="shadow-stroke overflow-hidden rounded-full"
            context="menu-item"
            size={20}
          />
        </div>
      </span>
      {/* Weight 500, not 600: the canon keeps 600 for the logo and markdown only. */}
      <span className="line-clamp-3 flex-1 py-0.5 font-medium text-text-secondary">{title}</span>
      <button
        className="tap-target flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary"
        type="button"
        aria-label={localize('com_ui_close_added_convo')}
        onClick={() => setAddedConvo(null)}
      >
        <X className="icon-md" aria-hidden="true" />
      </button>
    </div>
  );
}
