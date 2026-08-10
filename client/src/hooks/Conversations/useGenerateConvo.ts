import { useCallback, useRef, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import {
  getEndpointField,
  LocalStorageKeys,
  isAssistantsEndpoint,
  getDefaultParamsEndpoint,
} from 'librechat-data-provider';
import type {
  TEndpointsConfig,
  EModelEndpoint,
  TModelsConfig,
  TConversation,
  TPreset,
} from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import type { AssistantListItem } from '~/common';
import { buildDefaultConvo, getDefaultEndpoint, focusComposerUnlessBusy, logger } from '~/utils';
import useAssistantListMap from '~/hooks/Assistants/useAssistantListMap';
import { useGetEndpointsQuery } from '~/data-provider';
import store from '~/store';

const useGenerateConvo = ({
  index = 0,
  rootIndex,
  setConversation,
}: {
  index?: number;
  rootIndex: number;
  setConversation?: SetterOrUpdater<TConversation | null>;
}) => {
  const modelsQuery = useGetModelsQuery();
  const assistantsListMap = useAssistantListMap();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const cancelFocusRef = useRef<(() => void) | undefined>();
  const rootConvo = useRecoilValue(store.conversationByKeySelector(rootIndex));

  useEffect(() => {
    if (rootConvo?.conversationId != null && setConversation) {
      setConversation((prevState) => {
        if (!prevState) {
          return prevState;
        }
        const update = {
          ...prevState,
          conversationId: rootConvo.conversationId,
        } as TConversation;

        logger.log('conversation', 'Setting conversation from `useNewConvo`', update);
        return update;
      });
    }
  }, [rootConvo?.conversationId, setConversation]);

  const generateConversation = useCallback(
    ({
      template = {},
      preset,
      modelsData,
    }: {
      template?: Partial<TConversation>;
      preset?: Partial<TPreset>;
      modelsData?: TModelsConfig;
    } = {}) => {
      let conversation = {
        conversationId: 'new',
        title: 'New Chat',
        endpoint: null,
        ...template,
        createdAt: '',
        updatedAt: '',
      };

      if (rootConvo?.conversationId) {
        conversation.conversationId = rootConvo.conversationId;
      }

      const modelsConfig = modelsData ?? modelsQuery.data;

      const defaultEndpoint = getDefaultEndpoint({
        convoSetup: preset ?? conversation,
        endpointsConfig,
      });

      const endpointType = getEndpointField(endpointsConfig, defaultEndpoint, 'type');
      if (!conversation.endpointType && endpointType) {
        conversation.endpointType = endpointType;
      } else if (conversation.endpointType && !endpointType) {
        conversation.endpointType = undefined;
      }

      const isAssistantEndpoint = isAssistantsEndpoint(defaultEndpoint);
      const assistants: AssistantListItem[] = assistantsListMap[defaultEndpoint ?? ''] ?? [];

      if (
        conversation.assistant_id &&
        !assistantsListMap[defaultEndpoint ?? '']?.[conversation.assistant_id]
      ) {
        conversation.assistant_id = undefined;
      }

      if (!conversation.assistant_id && isAssistantEndpoint) {
        conversation.assistant_id =
          localStorage.getItem(`${LocalStorageKeys.ASST_ID_PREFIX}${index}${defaultEndpoint}`) ??
          assistants[0]?.id;
      }

      if (
        conversation.assistant_id != null &&
        isAssistantEndpoint &&
        conversation.conversationId === 'new'
      ) {
        const assistant = assistants.find((asst) => asst.id === conversation.assistant_id);
        conversation.model = assistant?.model;
      }

      if (conversation.assistant_id != null && !isAssistantEndpoint) {
        conversation.assistant_id = undefined;
      }

      const models = modelsConfig?.[defaultEndpoint ?? ''] ?? [];
      const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, defaultEndpoint);
      conversation = buildDefaultConvo({
        conversation,
        lastConversationSetup: preset as TConversation,
        endpoint: defaultEndpoint ?? ('' as EModelEndpoint),
        models,
        defaultParamsEndpoint,
      });

      if (preset?.title != null && preset.title !== '') {
        conversation.title = preset.title;
      }

      if (setConversation) {
        setConversation(conversation);
      }

      cancelFocusRef.current?.();
      cancelFocusRef.current = focusComposerUnlessBusy();
      return conversation;
    },
    [assistantsListMap, endpointsConfig, index, modelsQuery.data, rootConvo, setConversation],
  );

  return { generateConversation };
};

export default useGenerateConvo;
