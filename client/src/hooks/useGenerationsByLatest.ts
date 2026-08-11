import { EModelEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';

type TUseGenerations = {
  error?: boolean;
  endpoint?: string;
  messageId?: string;
  isEditing?: boolean;
  isSubmitting: boolean;
  searchResult?: boolean;
  finish_reason?: string;
  latestMessageId?: string;
  isCreatedByUser?: boolean;
};

export default function useGenerationsByLatest({
  error = false,
  endpoint,
  messageId,
  isEditing = false,
  isSubmitting,
  searchResult = false,
  finish_reason = '',
  latestMessageId,
  isCreatedByUser = false,
}: TUseGenerations) {
  const isEditableEndpoint = Boolean(
    [
      EModelEndpoint.openAI,
      EModelEndpoint.custom,
      EModelEndpoint.google,
      EModelEndpoint.agents,
      EModelEndpoint.bedrock,
      EModelEndpoint.anthropic,
      EModelEndpoint.azureOpenAI,
    ].find((e) => e === endpoint),
  );

  const continueSupported =
    latestMessageId === messageId &&
    finish_reason &&
    finish_reason !== 'stop' &&
    !isEditing &&
    !searchResult &&
    isEditableEndpoint;

  const branchingSupported = Boolean(
    [
      EModelEndpoint.azureOpenAI,
      EModelEndpoint.openAI,
      EModelEndpoint.custom,
      EModelEndpoint.agents,
      EModelEndpoint.bedrock,
      EModelEndpoint.google,
      EModelEndpoint.anthropic,
    ].find((e) => e === endpoint),
  );

  const regenerateEnabled =
    !isCreatedByUser && !searchResult && !isEditing && !isSubmitting && branchingSupported;

  /** This message can never be edited in this chat — an error turn, a search
   *  result, or an endpoint without branching. A RUNNING generation is not in
   *  here on purpose: that is a temporary state, and the owner's rule for the
   *  action row is that buttons stay visible — the caller disables the edit
   *  button for the stream's duration instead of vanishing it. */
  const editUnavailable =
    error || searchResult || !branchingSupported || (!isEditableEndpoint && !isCreatedByUser);

  const forkingSupported = !isAssistantsEndpoint(endpoint) && !searchResult;

  return {
    forkingSupported,
    continueSupported,
    regenerateEnabled,
    isEditableEndpoint,
    editUnavailable,
  };
}
