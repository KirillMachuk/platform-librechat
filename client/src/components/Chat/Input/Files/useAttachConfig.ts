import { useMemo } from 'react';
import {
  Constants,
  supportsFiles,
  mergeFileConfig,
  isAgentsEndpoint,
  resolveEndpointType,
  isAssistantsEndpoint,
  getEndpointFileConfig,
} from 'librechat-data-provider';
import type { TConversation, EModelEndpoint, EndpointFileConfig } from 'librechat-data-provider';
import { useGetFileConfig, useGetEndpointsQuery, useGetAgentByIdQuery } from '~/data-provider';
import { useAgentsMapContext } from '~/Providers';

export interface AttachConfig {
  conversationId: string;
  endpoint?: string | null;
  endpointType?: EModelEndpoint | string;
  endpointFileConfig?: EndpointFileConfig;
  useResponsesApi?: boolean;
  isAgents: boolean;
  isUploadDisabled: boolean;
  /** 'direct' = the single paperclip that uploads anything (Auto decides the
   *  mode); 'menu' = the multi-resource list (real agents); null = no upload. */
  attachMode: 'direct' | 'menu' | null;
}

/**
 * The attach behaviour of a conversation, in one place: the desktop button
 * (AttachFileChat) and the phone's «+» sheet both read THIS, so what a chat
 * can upload never depends on which surface asked.
 */
export default function useAttachConfig({
  conversation,
  disableInputs,
}: {
  conversation: TConversation | null;
  disableInputs: boolean;
}): AttachConfig {
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const { endpoint } = conversation ?? { endpoint: null };
  const isAgents = useMemo(() => isAgentsEndpoint(endpoint), [endpoint]);
  const isAssistants = useMemo(() => isAssistantsEndpoint(endpoint), [endpoint]);

  const agentsMap = useAgentsMapContext();

  const needsAgentFetch = useMemo(() => {
    if (!isAgents || !conversation?.agent_id) {
      return false;
    }
    const agent = agentsMap?.[conversation.agent_id];
    return !agent?.model_parameters;
  }, [isAgents, conversation?.agent_id, agentsMap]);

  const { data: agentData } = useGetAgentByIdQuery(conversation?.agent_id, {
    enabled: needsAgentFetch,
  });

  const useResponsesApi = useMemo(() => {
    if (!isAgents || !conversation?.agent_id || conversation?.useResponsesApi !== undefined) {
      return conversation?.useResponsesApi;
    }
    return (
      agentData?.model_parameters?.useResponsesApi ??
      agentsMap?.[conversation.agent_id]?.model_parameters?.useResponsesApi
    );
  }, [isAgents, conversation?.agent_id, conversation?.useResponsesApi, agentData, agentsMap]);

  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  const { data: endpointsConfig } = useGetEndpointsQuery();

  const agentProvider = useMemo(() => {
    if (!isAgents || !conversation?.agent_id) {
      return undefined;
    }
    return agentData?.provider ?? agentsMap?.[conversation.agent_id]?.provider;
  }, [isAgents, conversation?.agent_id, agentData, agentsMap]);

  const endpointType = useMemo(
    () => resolveEndpointType(endpointsConfig, endpoint, agentProvider),
    [endpointsConfig, endpoint, agentProvider],
  );

  const fileConfigEndpoint = useMemo(
    () => (isAgents && agentProvider ? agentProvider : endpoint),
    [isAgents, agentProvider, endpoint],
  );
  const endpointFileConfig = useMemo(
    () =>
      getEndpointFileConfig({
        fileConfig,
        endpointType,
        endpoint: fileConfigEndpoint,
      }),
    [fileConfigEndpoint, fileConfig, endpointType],
  );
  const endpointSupportsFiles: boolean = useMemo(
    () => supportsFiles[endpointType ?? endpoint ?? ''] ?? false,
    [endpointType, endpoint],
  );
  const isUploadDisabled = useMemo(
    () => (disableInputs || endpointFileConfig?.disabled) ?? false,
    [disableInputs, endpointFileConfig?.disabled],
  );

  // ChatGPT-style attach: assistants and plain custom/LLM endpoints get a
  // single paperclip that uploads any supported file immediately (no mode
  // menu, no per-type accept filter). The file's handling mode is decided by
  // Auto and surfaced in the toolbar FileMode control. Only real agents keep
  // the multi-resource menu (code environment, etc.).
  const attachMode = useMemo<AttachConfig['attachMode']>(() => {
    if (isUploadDisabled) {
      return null;
    }
    if (isAssistants || (!isAgents && endpointSupportsFiles)) {
      return 'direct';
    }
    if (isAgents || endpointSupportsFiles) {
      return 'menu';
    }
    return null;
  }, [isAssistants, isAgents, endpointSupportsFiles, isUploadDisabled]);

  return {
    conversationId,
    endpoint,
    endpointType,
    endpointFileConfig,
    useResponsesApi,
    isAgents,
    isUploadDisabled,
    attachMode,
  };
}
