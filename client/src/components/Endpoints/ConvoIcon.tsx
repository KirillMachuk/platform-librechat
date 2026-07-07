import React, { useMemo } from 'react';
import { getEndpointField } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import { getModelBrandIcon } from '~/components/Chat/Menus/Endpoints/components/brand';
import { getIconKey, getEntity, getIconEndpoint } from '~/utils';
import ConvoIconURL from '~/components/Endpoints/ConvoIconURL';
import { icons } from '~/hooks/Endpoint/Icons';
import { isImageURL } from '~/utils/icons';

export default function ConvoIcon({
  conversation,
  endpointsConfig,
  assistantMap,
  agentsMap,
  className = '',
  containerClassName = '',
  context,
  size,
}: {
  conversation: t.TConversation | t.TPreset | null;
  endpointsConfig: t.TEndpointsConfig;
  assistantMap: t.TAssistantsMap | undefined;
  agentsMap: t.TAgentsMap | undefined;
  containerClassName?: string;
  context?: 'message' | 'nav' | 'landing' | 'menu-item';
  className?: string;
  size?: number;
}) {
  const iconURL = conversation?.iconURL ?? '';
  let endpoint = conversation?.endpoint;
  endpoint = getIconEndpoint({ endpointsConfig, iconURL, endpoint });

  const { entity, isAgent } = useMemo(
    () =>
      getEntity({
        endpoint,
        agentsMap,
        assistantMap,
        agent_id: conversation?.agent_id,
        assistant_id: conversation?.assistant_id,
      }),
    [endpoint, conversation?.agent_id, conversation?.assistant_id, agentsMap, assistantMap],
  );

  const name = entity?.name ?? '';
  const avatar = isAgent
    ? (entity as t.Agent | undefined)?.avatar?.filepath
    : ((entity as t.Assistant | undefined)?.metadata?.avatar as string);

  const endpointIconURL = getEndpointField(endpointsConfig, endpoint, 'iconURL');
  const iconKey = getIconKey({ endpoint, endpointsConfig, endpointIconURL });
  const Icon = icons[iconKey] ?? null;

  // Fall back to the model's vendor brand mark when the endpoint has no icon of
  // its own (e.g. the custom "1ma" endpoint) — otherwise the generic bot renders
  // white-on-white in light theme. null for agents/assistants and unknown vendors,
  // so the entity avatar / endpoint icon below still wins.
  const brandIcon = useMemo(
    () =>
      !endpointIconURL && !avatar && conversation?.model
        ? getModelBrandIcon(conversation.model, size)
        : null,
    [endpointIconURL, avatar, conversation?.model, size],
  );

  return (
    <>
      {isImageURL(iconURL) ? (
        <ConvoIconURL
          iconURL={iconURL}
          modelLabel={conversation?.chatGptLabel ?? conversation?.modelLabel ?? ''}
          endpointIconURL={endpointIconURL}
          assistantAvatar={avatar}
          assistantName={name}
          agentAvatar={avatar}
          agentName={name}
          context={context}
        />
      ) : (
        <div className={containerClassName}>
          {brandIcon ? (
            <div className={className}>{brandIcon}</div>
          ) : (
            endpoint &&
            Icon != null && (
              <Icon
                size={size}
                context={context}
                endpoint={endpoint}
                className={className}
                iconURL={endpointIconURL}
                assistantName={name}
                agentName={name}
                avatar={avatar}
              />
            )
          )}
        </div>
      )}
    </>
  );
}
