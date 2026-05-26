import { useEffect, useRef } from 'react';
import { useRecoilValue } from 'recoil';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { Constants, EModelEndpoint, LocalStorageKeys } from 'librechat-data-provider';
import type { ConvoGenerator } from '~/common';
import { useAgentsMapContext } from '~/Providers';
import { useGetStartupConfig } from '~/data-provider';
import store from '~/store';

interface UseDefaultSelectionParams {
  index?: number;
  conversationId: string | null | undefined;
  newConversation: ConvoGenerator;
}

/** Seeds a default endpoint/model on every blank new conversation.
 *
 * Priority order:
 *   1. `interface.defaultAgentId` (yaml) — picks a DB-backed agent (future Auto orchestrator).
 *   2. `interface.defaultModel` (yaml) — picks a raw LLM (current behavior, e.g. Sonnet).
 *   3. No-op — LibreChat falls back to its own last-used / first-available default.
 *
 * Pass `newConversation` from the chat shell (reuses the existing instance from useChatHelpers).
 * Idempotent under React strict-mode double-mount and resilient against agentsMap/newConversation
 * reference churn — the effect short-circuits if the same conversationId has already been seeded. */
export default function useDefaultSelection({
  index = 0,
  conversationId,
  newConversation,
}: UseDefaultSelectionParams) {
  const { data: startupConfig } = useGetStartupConfig();
  const { data: modelsByEndpoint } = useGetModelsQuery();
  const agentsMap = useAgentsMapContext();
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(index));
  const model = useRecoilValue(store.conversationModelByIndex(index));
  const agent_id = useRecoilValue(store.conversationAgentIdByIndex(index));

  const defaultAgentId = startupConfig?.interface?.defaultAgentId;
  const defaultModel = startupConfig?.interface?.defaultModel;
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    const isBlankConvo = !conversationId || conversationId === Constants.NEW_CONVO;
    if (!isBlankConvo) return;

    const convoKey = conversationId ?? Constants.NEW_CONVO;
    if (seededForRef.current === convoKey) return;

    if (endpoint || model || agent_id) {
      seededForRef.current = convoKey;
      return;
    }

    if (defaultAgentId && agentsMap && defaultAgentId in agentsMap) {
      seededForRef.current = convoKey;
      localStorage.setItem(`${LocalStorageKeys.AGENT_ID_PREFIX}${index}`, defaultAgentId);
      newConversation({
        template: {
          endpoint: EModelEndpoint.agents,
          agent_id: defaultAgentId,
          model: agentsMap[defaultAgentId]?.model ?? '',
        },
      });
      return;
    }

    if (defaultModel?.endpoint && defaultModel?.model) {
      const availableModels = modelsByEndpoint?.[defaultModel.endpoint];
      if (!availableModels?.includes(defaultModel.model)) return;

      seededForRef.current = convoKey;
      newConversation({
        template: {
          endpoint: defaultModel.endpoint as EModelEndpoint,
          model: defaultModel.model,
        },
      });
    }
  }, [
    conversationId,
    defaultAgentId,
    defaultModel,
    agentsMap,
    modelsByEndpoint,
    endpoint,
    model,
    agent_id,
    index,
    newConversation,
  ]);
}
