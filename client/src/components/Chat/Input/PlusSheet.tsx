import { Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import { useRecoilState } from 'recoil';
import { FileUpload, Switch, VectorIcon } from '@librechat/client';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import {
  Permissions,
  ArtifactModes,
  PermissionTypes,
  defaultAgentCapabilities,
} from 'librechat-data-provider';
import type { EToolResources, TConversation } from 'librechat-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';
import {
  X,
  Plus,
  Globe,
  Camera,
  Folder,
  ImageIcon,
  Telescope,
  ScrollText,
  WandSparkles,
  TerminalSquareIcon,
} from '~/components/icons';
import {
  useLocalize,
  useHasAccess,
  useAgentCapabilities,
  useAgentToolPermissions,
  useFileHandlingNoChatContext,
} from '~/hooks';
import { buildAttachItems, acceptForFileType } from './Files/attachItems';
import useAttachConfig from './Files/useAttachConfig';
import { ephemeralAgentByConvoId } from '~/store';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

interface PlusSheetProps {
  conversation: TConversation | null;
  disableInputs: boolean;
  showEphemeralBadges: boolean;
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Book screen 5, «Мобильная шторка "плюс"»: 52px row — icon, label, switch. */
function ToolRow({
  icon,
  label,
  checked,
  onToggle,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex h-[52px] items-center gap-3 px-4" data-testid={testId}>
      <span className="flex-shrink-0 text-text-secondary" aria-hidden="true">
        {icon}
      </span>
      <span id={`${testId}-label`} className="flex-1 truncate text-[15px] text-text-primary">
        {label}
      </span>
      <Switch aria-labelledby={`${testId}-label`} checked={checked} onCheckedChange={onToggle} />
    </div>
  );
}

/**
 * The phone's «+» — everything the composer can add, in one bottom sheet
 * (book screen 5): tiles for Camera / Photo / Files, the agent upload modes
 * when the chat is a real agent, and the tool toggles that the desktop keeps
 * in the Tools dropdown. On the phone there is NO separate tools button — the
 * book's rule — so this sheet is the single entry point. Both it and the
 * desktop menu render the ONE list from attachItems.tsx, so they cannot
 * drift apart.
 */
function PlusSheet({
  conversation,
  disableInputs,
  showEphemeralBadges,
  files,
  setFiles,
  setFilesLoading,
}: PlusSheetProps) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toolResourceRef = useRef<EToolResources | undefined>();

  const context = useBadgeRowContext();
  const {
    attachMode,
    endpoint,
    endpointType,
    endpointFileConfig,
    useResponsesApi,
    conversationId,
  } = useAttachConfig({ conversation, disableInputs });

  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(
    ephemeralAgentByConvoId(conversationId),
  );
  const { handleFileChange } = useFileHandlingNoChatContext(undefined, {
    files,
    setFiles,
    setFilesLoading,
    conversation,
  });

  const capabilities = useAgentCapabilities(
    context?.agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );
  const { fileSearchAllowedByAgent, codeAllowedByAgent, provider } = useAgentToolPermissions(
    conversation?.agent_id,
    ephemeralAgent,
  );

  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const canUseDeepResearch = useHasAccess({
    permissionType: PermissionTypes.DEEP_RESEARCH,
    permission: Permissions.USE,
  });
  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });
  const canUseFileSearch = useHasAccess({
    permissionType: PermissionTypes.FILE_SEARCH,
    permission: Permissions.USE,
  });
  const canUseSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });

  const {
    skills,
    webSearch,
    deepResearch,
    artifacts,
    fileSearch,
    codeInterpreter,
    toolLoopUnavailable,
    activeModel,
  } = context ?? {};
  const toolLoopAvailable = toolLoopUnavailable !== true;

  /** The same ONE list the desktop paperclip menu renders. */
  const attachItems = useMemo(
    () =>
      buildAttachItems({
        localize,
        provider,
        endpoint,
        endpointType,
        useResponsesApi,
        contextEnabled: capabilities.contextEnabled,
        fileSearchEnabled: capabilities.fileSearchEnabled && fileSearchAllowedByAgent,
        codeEnabled: capabilities.codeEnabled && codeAllowedByAgent,
      }),
    [
      localize,
      provider,
      endpoint,
      endpointType,
      useResponsesApi,
      capabilities.contextEnabled,
      capabilities.fileSearchEnabled,
      capabilities.codeEnabled,
      fileSearchAllowedByAgent,
      codeAllowedByAgent,
    ],
  );
  const defaultItem = attachItems.find((item) => item.key === 'default');
  const modeItems = attachMode === 'menu' ? attachItems.filter((i) => i.key !== 'default') : [];

  const openPicker = useCallback(
    ({
      accept,
      capture,
      toolResource,
      armsEphemeralToggle,
    }: {
      accept: string;
      capture?: string;
      toolResource?: EToolResources;
      armsEphemeralToggle?: boolean;
    }) => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      toolResourceRef.current = toolResource;
      if (armsEphemeralToggle === true && toolResource != null) {
        setEphemeralAgent((prev) => ({ ...prev, [toolResource]: true }));
      }
      input.value = '';
      input.accept = accept;
      if (capture != null) {
        input.setAttribute('capture', capture);
      } else {
        input.removeAttribute('capture');
      }
      input.click();
      input.accept = '';
      input.removeAttribute('capture');
      setOpen(false);
    },
    [setEphemeralAgent],
  );

  /** «Файлы» behaves exactly like the chat's own attach button: no filter for
   *  the direct paperclip, the provider's default accept for an agent. */
  const defaultAccept =
    attachMode === 'menu' ? acceptForFileType(defaultItem?.fileType, endpointFileConfig) : '';

  const tiles =
    attachMode == null
      ? []
      : [
          {
            key: 'camera',
            label: localize('com_ui_camera'),
            icon: <Camera className="icon-lg" aria-hidden="true" />,
            onClick: () => openPicker({ accept: 'image/*', capture: 'environment' }),
          },
          {
            key: 'photo',
            label: localize('com_ui_photo'),
            icon: <ImageIcon className="icon-lg" aria-hidden="true" />,
            onClick: () => openPicker({ accept: 'image/*,.heif,.heic' }),
          },
          {
            key: 'files',
            label: localize('com_ui_files'),
            icon: <Folder className="icon-lg" aria-hidden="true" />,
            onClick: () => openPicker({ accept: defaultAccept }),
          },
        ];

  const showTools = showEphemeralBadges && context != null;
  /** The book's order for the sheet: search, research, code, file search,
   *  skills, artifacts. Gating is exactly the desktop dropdown's. */
  const toolRows = !showTools
    ? []
    : [
        capabilities.webSearchEnabled &&
          canUseWebSearch &&
          toolLoopAvailable && {
            key: 'web_search',
            icon: <Globe className="icon-md" aria-hidden="true" />,
            label: localize('com_ui_web_search'),
            checked: webSearch?.toggleState === true,
            onToggle: (value: boolean) => webSearch?.debouncedChange({ value }),
          },
        canUseWebSearch &&
          canUseDeepResearch &&
          capabilities.deepResearchEnabled && {
            key: 'deep_research',
            icon: <Telescope className="icon-md" aria-hidden="true" />,
            label: localize('com_ui_deep_research'),
            checked: deepResearch?.toggleState === true,
            onToggle: (value: boolean) => deepResearch?.debouncedChange({ value }),
          },
        canRunCode &&
          capabilities.codeEnabled &&
          toolLoopAvailable && {
            key: 'run_code',
            icon: <TerminalSquareIcon className="icon-md" aria-hidden="true" />,
            label: localize('com_ui_run_code'),
            checked: codeInterpreter?.toggleState === true,
            onToggle: (value: boolean) => codeInterpreter?.debouncedChange({ value }),
          },
        capabilities.fileSearchEnabled &&
          canUseFileSearch &&
          toolLoopAvailable && {
            key: 'file_search',
            icon: <VectorIcon className="icon-md" />,
            label: localize('com_assistants_file_search'),
            checked: fileSearch?.toggleState === true,
            onToggle: (value: boolean) => fileSearch?.debouncedChange({ value }),
          },
        canUseSkills &&
          capabilities.skillsEnabled && {
            key: 'skills',
            icon: <ScrollText className="icon-md" aria-hidden="true" />,
            label: localize('com_ui_skills'),
            checked: skills?.toggleState === true,
            onToggle: (value: boolean) => skills?.debouncedChange({ value }),
          },
        capabilities.artifactsEnabled &&
          artifacts != null && {
            key: 'artifacts',
            icon: <WandSparkles className="icon-md" aria-hidden="true" />,
            label: localize('com_ui_artifacts'),
            checked: Boolean(artifacts.toggleState),
            onToggle: (value: boolean) =>
              artifacts.debouncedChange({ value: value ? ArtifactModes.DEFAULT : '' }),
          },
      ].filter((row): row is Exclude<typeof row, false> => Boolean(row));

  if (attachMode == null && toolRows.length === 0 && !toolLoopUnavailable) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        aria-label={localize('com_ui_add')}
        data-testid="plus-sheet-trigger"
        disabled={disableInputs}
        onClick={() => setOpen(true)}
        className="tap-target flex size-[38px] items-center justify-center rounded-full text-text-secondary transition-colors duration-90 hover:bg-surface-hover md:hidden"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>

      <FileUpload
        ref={inputRef}
        handleFileChange={(e) => {
          handleFileChange(e, toolResourceRef.current);
          toolResourceRef.current = undefined;
        }}
      >
        <span className="hidden" />
      </FileUpload>

      <Transition appear show={open} as={Fragment}>
        <Dialog as="div" className="relative z-dialog md:hidden" onClose={() => setOpen(false)}>
          <TransitionChild
            enter="ease-out duration-120"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-120"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-[color:var(--c-scrim)]" aria-hidden="true" />
          </TransitionChild>

          <TransitionChild
            enter="ease-out duration-200"
            enterFrom="translate-y-full"
            enterTo="translate-y-0"
            leave="ease-in duration-120"
            leaveFrom="translate-y-0"
            leaveTo="translate-y-full"
          >
            <DialogPanel
              className={cn(
                'fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl',
                'bg-surface-secondary shadow-lg',
                'px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]',
              )}
              data-testid="plus-sheet"
            >
              <div className="relative flex flex-col items-center pb-2 pt-2">
                <div className="h-1 w-9 rounded-full bg-surface-active" aria-hidden="true" />
                <DialogTitle className="mt-3 self-start px-1 text-base font-medium text-text-primary">
                  {localize('com_ui_add')}
                </DialogTitle>
                <button
                  type="button"
                  aria-label={localize('com_ui_close')}
                  onClick={() => setOpen(false)}
                  className="absolute right-0 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover"
                >
                  <X className="icon-md" aria-hidden="true" />
                </button>
              </div>

              {tiles.length > 0 && (
                <div className="grid grid-cols-3 gap-2.5">
                  {tiles.map((tile) => (
                    <button
                      key={tile.key}
                      type="button"
                      onClick={tile.onClick}
                      className="flex h-[98px] flex-col items-center justify-center gap-2.5 rounded-xl bg-surface-primary text-[15px] text-text-primary transition-colors duration-90 hover:bg-surface-hover"
                    >
                      {tile.icon}
                      <span>{tile.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {modeItems.length > 0 && (
                <div className="mt-2.5 rounded-xl bg-surface-primary">
                  {modeItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        openPicker({
                          accept: acceptForFileType(item.fileType, endpointFileConfig),
                          toolResource: item.toolResource,
                          armsEphemeralToggle: item.armsEphemeralToggle,
                        })
                      }
                      className="flex h-[52px] w-full items-center gap-3 px-4 text-[15px] text-text-primary transition-colors duration-90 hover:bg-surface-hover"
                    >
                      <span className="flex-shrink-0 text-text-secondary" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {toolRows.length > 0 && (
                <div className="mt-2.5 divide-y divide-border-light rounded-xl bg-surface-primary">
                  {toolRows.map((row) => (
                    <ToolRow
                      key={row.key}
                      icon={row.icon}
                      label={row.label}
                      checked={row.checked}
                      onToggle={row.onToggle}
                      testId={`plus-sheet-${row.key}`}
                    />
                  ))}
                </div>
              )}

              {showTools && toolLoopUnavailable === true && (
                <p className="mt-2.5 px-1 text-sm text-text-secondary">
                  {localize('com_ui_tools_unavailable_model')}
                  {activeModel != null && activeModel !== '' ? (
                    <span className="mt-0.5 block opacity-70">{activeModel}</span>
                  ) : null}
                </p>
              )}
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>
    </>
  );
}

export default memo(PlusSheet);
