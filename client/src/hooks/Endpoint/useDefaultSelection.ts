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

/** Seeds a default endpoint/model on a blank new conversation.
 *
 * Priority order (blank conversation only; never touches an existing one):
 *   1. Restored/selected agent — always respected; the model default never overrides it.
 *   2. `interface.defaultAgentId` (yaml) — a DB-backed agent, only when nothing is selected.
 *   3. `interface.defaultModel` (yaml) — the configured LLM (e.g. Sonnet 5). Applied on the
 *      first run per mount even if a model was restored from localStorage, so it is the model
 *      the user sees on entry rather than their last-used one.
 *   4. No default configured — the restored / last-used selection is left as-is.
 *
 * Once-per-mount: `seededForRef` short-circuits after the first run for a conversationId, so a
 * user's in-session model pick is preserved, while a New Chat navigation (fresh mount) re-applies
 * the default. Idempotent under React strict-mode double-mount and resilient against
 * agentsMap/newConversation reference churn. Pass `newConversation` from the chat shell. */
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

  /** ChatView is a single long-lived instance (no route `key`), so `seededForRef`
   *  persists across New Chat. Clear it once a real conversation is active so the
   *  next blank conversation re-applies the default — a user's in-session pick on
   *  the current blank conversation is still preserved (it is guarded by
   *  `seededForRef` until they navigate away). */
  useEffect(() => {
    if (conversationId && conversationId !== Constants.NEW_CONVO) {
      seededForRef.current = null;
    }
  }, [conversationId]);

  useEffect(() => {
    const isBlankConvo = !conversationId || conversationId === Constants.NEW_CONVO;
    if (!isBlankConvo) return;

    const convoKey = conversationId ?? Constants.NEW_CONVO;
    if (seededForRef.current === convoKey) return;

    /** An agent selection (restored or picked) is always respected — the model
     *  default never overrides an agent. */
    if (agent_id) {
      seededForRef.current = convoKey;
      return;
    }

    /** Agent default: only when nothing is selected yet (never overrides a
     *  restored model). */
    if (defaultAgentId && agentsMap && defaultAgentId in agentsMap && !endpoint && !model) {
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

    /** Model default: apply on the first run per mount even when a model was
     *  restored from localStorage, so the configured default (e.g. Sonnet 5) is
     *  the entry model rather than the last-used one — the previous behaviour
     *  only seeded users with an empty store. A user's in-session pick is still
     *  respected because `seededForRef` blocks re-seeding after this first run,
     *  and a New Chat navigation legitimately re-applies the default. */
    if (defaultModel?.endpoint && defaultModel?.model) {
      const availableModels = modelsByEndpoint?.[defaultModel.endpoint];
      /** Default not available yet (models still loading, or misconfigured) —
       *  leave the restored model and retry when the query resolves. */
      if (!availableModels?.includes(defaultModel.model)) return;

      seededForRef.current = convoKey;
      /** Already on the default — nothing to rebuild. */
      if (endpoint === defaultModel.endpoint && model === defaultModel.model) return;
      newConversation({
        template: {
          endpoint: defaultModel.endpoint as EModelEndpoint,
          model: defaultModel.model,
        },
      });
      return;
    }

    /** No default configured — preserve the restored selection as-is. */
    if (endpoint || model) {
      seededForRef.current = convoKey;
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
