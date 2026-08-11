import { memo } from 'react';
import type { TConversation } from 'librechat-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';
import useAttachConfig from './useAttachConfig';
import AttachFileMenu from './AttachFileMenu';
import AttachFile from './AttachFile';

function AttachFileChat({
  disableInputs,
  conversation,
  files,
  setFiles,
  setFilesLoading,
}: {
  disableInputs: boolean;
  conversation: TConversation | null;
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  /** Which attach behaviour this chat gets is decided in useAttachConfig,
   *  shared with the phone's «+» sheet — see the hook for the reasoning. */
  const {
    attachMode,
    endpoint,
    endpointType,
    endpointFileConfig,
    useResponsesApi,
    conversationId,
  } = useAttachConfig({ conversation, disableInputs });

  if (attachMode === 'direct') {
    return (
      <AttachFile
        disabled={disableInputs}
        files={files}
        setFiles={setFiles}
        setFilesLoading={setFilesLoading}
        conversation={conversation}
      />
    );
  }
  if (attachMode === 'menu') {
    return (
      <AttachFileMenu
        endpoint={endpoint}
        disabled={disableInputs}
        endpointType={endpointType}
        conversationId={conversationId}
        agentId={conversation?.agent_id}
        endpointFileConfig={endpointFileConfig}
        useResponsesApi={useResponsesApi}
        files={files}
        setFiles={setFiles}
        setFilesLoading={setFilesLoading}
        conversation={conversation}
      />
    );
  }
  return null;
}

export default memo(AttachFileChat);
