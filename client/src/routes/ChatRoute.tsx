import { useEffect } from 'react';
import { useRecoilCallback, useRecoilValue } from 'recoil';
import { Spinner, useToastContext } from '@librechat/client';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { TPreset, TConversation } from 'librechat-data-provider';
import {
  mergeQuerySettingsWithSpec,
  processValidSettings,
  getDefaultModelSpec,
  getModelSpecPreset,
  isNotFoundError,
  buildConvoPath,
  logger,
} from '~/utils';
import {
  useAssistantListMap,
  useIdChangeEffect,
  useAppStartup,
  useNewConvo,
  useLocalize,
} from '~/hooks';
import { useGetConvoIdQuery, useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import { ToolCallsMapProvider } from '~/Providers';
import ChatView from '~/components/Chat/ChatView';
import { NotificationSeverity } from '~/common';
import useAuthRedirect from './useAuthRedirect';
import temporaryStore from '~/store/temporary';
import store from '~/store';

export default function ChatRoute() {
  const { data: startupConfig } = useGetStartupConfig();
  const { isAuthenticated, user, roles } = useAuthRedirect();

  const defaultTemporaryChat = useRecoilValue(temporaryStore.defaultTemporaryChat);
  const setIsTemporary = useRecoilCallback(
    ({ set }) =>
      (value: boolean) => {
        set(temporaryStore.isTemporary, value);
      },
    [],
  );
  useAppStartup({ startupConfig, user });

  const index = 0;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { conversationId = '', projectId } = useParams();
  useIdChangeEffect(conversationId);
  const { hasSetConversation, conversation } = store.useCreateConversationAtom(index);
  const { setConversation } = store.useSetConversationAtom(index);
  const { newConversation } = useNewConvo();
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const modelsQuery = useGetModelsQuery({
    enabled: isAuthenticated,
    refetchOnMount: 'always',
  });
  const initialConvoQuery = useGetConvoIdQuery(conversationId, {
    enabled:
      isAuthenticated && conversationId !== Constants.NEW_CONVO && !hasSetConversation.current,
  });
  const endpointsQuery = useGetEndpointsQuery({ enabled: isAuthenticated });
  const assistantListMap = useAssistantListMap();

  const isTemporaryChat = conversation && conversation.expiredAt ? true : false;

  useEffect(() => {
    if (conversationId === Constants.NEW_CONVO) {
      setIsTemporary(defaultTemporaryChat);
    } else if (isTemporaryChat) {
      setIsTemporary(isTemporaryChat);
    } else {
      setIsTemporary(false);
    }
  }, [conversationId, isTemporaryChat, setIsTemporary, defaultTemporaryChat]);

  /** This effect is mainly for the first conversation state change on first load of the page.
   *  Adjusting this may have unintended consequences on the conversation state.
   */
  useEffect(() => {
    // Wait for roles to load so hasAgentAccess has a definitive value in useNewConvo
    const rolesLoaded = roles?.USER != null;
    const shouldSetConvo =
      (startupConfig && rolesLoaded && !hasSetConversation.current && !modelsQuery.data?.initial) ??
      false;
    /* Early exit if startupConfig is not loaded and conversation is already set and only initial models have loaded */
    if (!shouldSetConvo) {
      return;
    }

    const isNewConvo = conversationId === Constants.NEW_CONVO;

    const getNewConvoPreset = () => {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      const specPreset = spec ? getModelSpecPreset(spec) : undefined;

      const queryParams: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        if (key !== 'prompt' && key !== 'q' && key !== 'submit') {
          queryParams[key] = value;
        }
      });
      const querySettings = processValidSettings(queryParams);

      if (Object.keys(querySettings).length > 0) {
        return mergeQuerySettingsWithSpec(specPreset, querySettings);
      }
      return specPreset;
    };

    const projectIdParam = projectId ?? searchParams.get('project') ?? undefined;
    const applyProjectId = (template?: Partial<TConversation>): Partial<TConversation> | undefined => {
      if (!projectIdParam) return template;
      return { ...(template ?? {}), project_id: projectIdParam };
    };

    if (isNewConvo && endpointsQuery.data && modelsQuery.data) {
      const preset = getNewConvoPreset();

      logger.log('conversation', 'ChatRoute, new convo effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: applyProjectId(conversation ? conversation : undefined),
        ...(preset ? { preset } : {}),
      });

      hasSetConversation.current = true;
    } else if (initialConvoQuery.data && endpointsQuery.data && modelsQuery.data) {
      logger.log('conversation', 'ChatRoute initialConvoQuery', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        /* this is necessary to load all existing settings */
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    } else if (
      conversationId &&
      endpointsQuery.data &&
      modelsQuery.data &&
      initialConvoQuery.isError &&
      isNotFoundError(initialConvoQuery.error)
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      showToast({
        message: localize('com_ui_conversation_not_found'),
        severity: NotificationSeverity.WARNING,
      });
      logger.log(
        'conversation',
        'ChatRoute initialConvoQuery isNotFoundError',
        initialConvoQuery.error,
      );
      newConversation({
        modelsData: modelsQuery.data,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      isNewConvo &&
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      const preset = getNewConvoPreset();

      logger.log('conversation', 'ChatRoute new convo, assistants effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: applyProjectId(conversation ? conversation : undefined),
        ...(preset ? { preset } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      logger.log('conversation', 'ChatRoute convo, assistants effect', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    }
    /* Creates infinite render if all dependencies included due to newConversation invocations exceeding call stack before hasSetConversation.current becomes truthy */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roles,
    startupConfig,
    initialConvoQuery.data,
    initialConvoQuery.isError,
    endpointsQuery.data,
    modelsQuery.data,
    assistantListMap,
  ]);

  /**
   * Keep conversation.project_id in sync with the URL `:projectId` segment.
   * The big effect above gates on `hasSetConversation.current` and does not
   * re-fire on URL changes, so without this every cross-project navigation
   * leaves the atom stale (and the first message would persist with the
   * previous project_id or none at all). Idempotent: early-returns when
   * the atom already matches the URL.
   */
  useEffect(() => {
    if (!conversation) return;
    const next = projectId ?? null;
    const current = conversation.project_id ?? null;
    if (next === current) return;
    setConversation({ ...conversation, project_id: next ?? undefined });
  }, [projectId, conversation, setConversation]);

  /**
   * Canonicalize legacy chat URLs to the path-based project form.
   *
   * 1. /c/<id>?project=<projectId>  → /projects/<projectId>/c/<id>
   *    (covers old client builds and shared links from before the refactor)
   * 2. /c/<id> for a chat whose persisted convo has project_id
   *    → /projects/<projectId>/c/<id>
   *    (covers users opening pre-refactor bookmarks)
   *
   * Both replace history so the user does not see a flash; the canonical
   * URL is the only one in the back stack.
   */
  useEffect(() => {
    if (projectId) return;
    const queryProjectId = searchParams.get('project');
    if (queryProjectId && conversationId) {
      navigate(buildConvoPath({ conversationId, projectId: queryProjectId }), {
        replace: true,
      });
      return;
    }
    const persistedProjectId = initialConvoQuery.data?.project_id;
    if (persistedProjectId && conversationId && conversationId !== Constants.NEW_CONVO) {
      navigate(buildConvoPath({ conversationId, projectId: persistedProjectId }), {
        replace: true,
      });
    }
  }, [projectId, searchParams, conversationId, initialConvoQuery.data, navigate]);

  if (endpointsQuery.isLoading || modelsQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" aria-live="polite" role="status">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // if not a conversation
  if (conversation?.conversationId === Constants.SEARCH) {
    return null;
  }
  // if conversationId not match
  if (conversation?.conversationId !== conversationId && !conversation) {
    return null;
  }
  // if conversationId is null
  if (!conversationId) {
    return null;
  }

  return (
    <ToolCallsMapProvider conversationId={conversation.conversationId ?? ''}>
      <ChatView index={index} />
    </ToolCallsMapProvider>
  );
}
