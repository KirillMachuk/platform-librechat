import { useEffect, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { Constants, EModelEndpoint, LocalStorageKeys } from 'librechat-data-provider';
import type { ConvoGenerator } from '~/common';
import { useAgentsMapContext } from '~/Providers';
import { useGetStartupConfig } from '~/data-provider';
import store from '~/store';

interface UseDefaultAgentParams {
  index?: number;
  conversationId: string | null | undefined;
  newConversation: ConvoGenerator;
}

/** Selects the configured defaultAgentId once per blank new conversation.
 * Pass newConversation from the chat shell (reuses the existing instance from useChatHelpers).
 * Idempotent under React strict-mode double-mount and resilient against agentsMap/newConversation
 * reference churn — the effect short-circuits if the same conversationId has already been seeded. */
export default function useDefaultAgent({
  index = 0,
  conversationId,
  newConversation,
}: UseDefaultAgentParams) {
  const { data: startupConfig } = useGetStartupConfig();
  const agentsMap = useAgentsMapContext();
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(index));
  const agent_id = useRecoilValue(store.conversationAgentIdByIndex(index));

  const defaultAgentId = startupConfig?.interface?.defaultAgentId;
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!defaultAgentId) return;

    const isBlankConvo =
      !conversationId || conversationId === Constants.NEW_CONVO;
    if (!isBlankConvo) return;

    const convoKey = conversationId ?? Constants.NEW_CONVO;
    if (seededForRef.current === convoKey) return;

    if (endpoint || agent_id) {
      seededForRef.current = convoKey;
      return;
    }

    if (!agentsMap || !(defaultAgentId in agentsMap)) return;

    seededForRef.current = convoKey;
    localStorage.setItem(`${LocalStorageKeys.AGENT_ID_PREFIX}${index}`, defaultAgentId);

    newConversation({
      template: {
        endpoint: EModelEndpoint.agents,
        agent_id: defaultAgentId,
        model: agentsMap[defaultAgentId]?.model ?? '',
      },
    });
  }, [
    conversationId,
    defaultAgentId,
    agentsMap,
    endpoint,
    agent_id,
    index,
    newConversation,
  ]);
}
