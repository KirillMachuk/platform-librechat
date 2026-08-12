import {
  Providers,
  EToolResources,
  EModelEndpoint,
  isPermissiveMimeConfig,
  bedrockDocumentExtensions,
  isDocumentSupportedProvider,
} from 'librechat-data-provider';
import type { EndpointFileConfig } from 'librechat-data-provider';
import type { LocalizeFunction } from '~/common';
import {
  FileSearch,
  ImageUpIcon,
  FileType2Icon,
  FileImageIcon,
  TerminalSquareIcon,
} from '~/components/icons';

export type FileUploadType =
  | 'image'
  | 'document'
  | 'image_document'
  | 'image_document_extended'
  | 'image_document_video_audio';

export interface AttachItemSpec {
  key: 'default' | 'context' | 'file_search' | 'execute_code';
  label: string;
  icon: React.JSX.Element;
  /** Accept preset for the picker; undefined = no filter. */
  fileType?: FileUploadType;
  /** Upload target; undefined = the provider default. */
  toolResource?: EToolResources;
  /** file_search / execute_code also flip the ephemeral agent's toggle on. */
  armsEphemeralToggle?: boolean;
}

interface BuildAttachItemsArgs {
  localize: LocalizeFunction;
  provider?: string | null;
  endpoint?: string | null;
  endpointType?: EModelEndpoint | string;
  useResponsesApi?: boolean;
  endpointFileConfig?: EndpointFileConfig;
  contextEnabled: boolean;
  fileSearchEnabled: boolean;
  codeEnabled: boolean;
}

/** Document types only — no image/video/audio classes. iOS Safari shows its
 *  own «Медиатека / Снять / Выбрать файлы» sheet whenever the accept list
 *  includes image or video types; a docs-only list opens the Files browser
 *  DIRECTLY (owner, 12.08: the double chooser on the phone). Photos keep
 *  image/*: the web has no API to jump straight into the photo library, that
 *  step is Safari's own. */
export const DOCUMENTS_ONLY_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.rtf,.json,.xml,.html,.odt,.ods,.odp,.epub';

/** Accept preset for a picker, shared by the menu and the sheet. */
export function acceptForFileType(
  fileType: FileUploadType | undefined,
  endpointFileConfig?: EndpointFileConfig,
): string {
  if (fileType !== undefined && isPermissiveMimeConfig(endpointFileConfig?.supportedMimeTypes)) {
    return '';
  }
  if (fileType === 'image') {
    return 'image/*,.heif,.heic';
  }
  if (fileType === 'document') {
    return '.pdf,application/pdf';
  }
  if (fileType === 'image_document') {
    return 'image/*,.heif,.heic,.pdf,application/pdf';
  }
  if (fileType === 'image_document_extended') {
    return `image/*,.heif,.heic,${bedrockDocumentExtensions}`;
  }
  if (fileType === 'image_document_video_audio') {
    return 'image/*,.heif,.heic,.pdf,application/pdf,video/*,audio/*';
  }
  return '';
}

/**
 * The ONE list of attach actions. The desktop paperclip menu and the phone's
 * «+» sheet both render exactly this — the book's rule for the two surfaces is
 * that they are built from a single list and cannot drift apart.
 */
export function buildAttachItems({
  localize,
  provider,
  endpoint,
  endpointType,
  useResponsesApi,
  contextEnabled,
  fileSearchEnabled,
  codeEnabled,
}: BuildAttachItemsArgs): AttachItemSpec[] {
  const items: AttachItemSpec[] = [];

  let currentProvider = provider || endpoint;
  // This will be removed in a future PR to formally normalize Providers comparisons to be case insensitive
  if (currentProvider?.toLowerCase() === Providers.OPENROUTER) {
    currentProvider = Providers.OPENROUTER;
  }

  const isAzureWithResponsesApi =
    (currentProvider === EModelEndpoint.azureOpenAI ||
      endpointType === EModelEndpoint.azureOpenAI) &&
    useResponsesApi === true;

  if (
    isDocumentSupportedProvider(endpointType) ||
    isDocumentSupportedProvider(currentProvider) ||
    isAzureWithResponsesApi
  ) {
    let fileType: Exclude<FileUploadType, 'image' | 'document'> = 'image_document';
    if (currentProvider === Providers.GOOGLE || currentProvider === Providers.OPENROUTER) {
      fileType = 'image_document_video_audio';
    } else if (currentProvider === Providers.BEDROCK || endpointType === EModelEndpoint.bedrock) {
      fileType = 'image_document_extended';
    }
    items.push({
      key: 'default',
      label: localize('com_ui_upload_provider'),
      icon: <FileImageIcon className="icon-md" />,
      fileType,
    });
  } else {
    items.push({
      key: 'default',
      label: localize('com_ui_upload_image_input'),
      icon: <ImageUpIcon className="icon-md" />,
      fileType: 'image',
    });
  }

  if (contextEnabled) {
    items.push({
      key: 'context',
      label: localize('com_ui_upload_ocr_text'),
      icon: <FileType2Icon className="icon-md" />,
      toolResource: EToolResources.context,
    });
  }

  if (fileSearchEnabled) {
    items.push({
      key: 'file_search',
      label: localize('com_ui_upload_file_search'),
      icon: <FileSearch className="icon-md" />,
      toolResource: EToolResources.file_search,
      armsEphemeralToggle: true,
    });
  }

  if (codeEnabled) {
    items.push({
      key: 'execute_code',
      label: localize('com_ui_upload_code_environment'),
      icon: <TerminalSquareIcon className="icon-md" />,
      toolResource: EToolResources.execute_code,
      armsEphemeralToggle: true,
    });
  }

  return items;
}
