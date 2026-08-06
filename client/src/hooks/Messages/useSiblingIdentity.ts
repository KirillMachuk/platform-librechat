import { useMemo } from 'react';
import { EModelEndpoint, parseEphemeralAgentId, stripAgentIdSuffix } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';
import { modelDisplayName } from '~/components/Chat/Menus/Endpoints/utils';
import { useGetEndpointsQuery } from '~/data-provider';
import { useAgentsMapContext } from '~/Providers';

export type SiblingIdentity = {
  displayName: string;
  displayEndpoint?: EModelEndpoint | string;
  displayModel?: string | null;
  agent?: Agent;
};

/**
 * Who wrote one column of a parallel answer, from its `agentId`.
 *
 * Shared rather than inlined in the header: on a phone the answers are switched
 * by a segment that has to spell out the same names, and two copies of this
 * would have drifted into calling the same column different things.
 */
export function useSiblingIdentity(agentId?: string): SiblingIdentity {
  const agentsMap = useAgentsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();

  return useMemo(() => {
    if (!agentId) {
      return { displayName: 'Agent', displayEndpoint: EModelEndpoint.agents };
    }

    /* The ____N suffix distinguishes parallel agents that share an ID. */
    const baseAgentId = stripAgentIdSuffix(agentId);
    const foundAgent = agentsMap?.[baseAgentId] as Agent | undefined;
    if (foundAgent) {
      return {
        displayName: foundAgent.name ?? baseAgentId,
        displayEndpoint: EModelEndpoint.agents,
        displayModel: foundAgent.model,
        agent: foundAgent,
      };
    }

    const parsed = parseEphemeralAgentId(agentId);
    if (parsed) {
      /**
       * The sender falls back to the endpoint's modelDisplayLabel, which is one
       * shared string for every model it serves — so side-by-side answers would
       * carry the same name, hiding the very thing being compared. Name the model
       * in that case, and keep the sender when it says something per-model.
       */
      const endpointLabel = endpointsConfig?.[parsed.endpoint ?? '']?.modelDisplayLabel;
      const senderIsEndpointLabel = parsed.sender != null && parsed.sender === endpointLabel;
      const model = parsed.model
        ? modelDisplayName(parsed.model, endpointsConfig, parsed.endpoint)
        : undefined;
      return {
        displayName:
          (senderIsEndpointLabel ? model || parsed.sender : parsed.sender) || model || 'AI',
        displayEndpoint: parsed.endpoint,
        displayModel: parsed.model,
      };
    }

    return { displayName: baseAgentId, displayEndpoint: EModelEndpoint.agents };
  }, [agentId, agentsMap, endpointsConfig]);
}

export default useSiblingIdentity;
