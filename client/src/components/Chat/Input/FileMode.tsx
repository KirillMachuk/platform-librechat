import React, { memo, useMemo, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Sparkles, FileType2Icon, FileImageIcon, FileSearch as FileSearchIcon } from 'lucide-react';
import { TooltipAnchor, DropdownPopup } from '@librechat/client';
import { Constants, EToolResources } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { MenuItemProps } from '~/common';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { resolveFileToolResource, isImageMimetype, type FileMode } from '~/utils/fileMode';
import { useChatContext } from '~/Providers/ChatContext';
import { useBadgeRowContext } from '~/Providers';
import { fileModeByConvoId } from '~/store';
import { useLocalize } from '~/hooks';
import { useRecoilState } from 'recoil';
import { cn } from '~/utils';

const MODE_ICONS: Record<FileMode, LucideIcon> = {
  auto: Sparkles,
  text: FileType2Icon,
  native: FileImageIcon,
  search: FileSearchIcon,
};

const MODE_LABEL_KEYS: Record<FileMode, TranslationKeys> = {
  auto: 'com_ui_file_mode_auto',
  text: 'com_ui_file_mode_text',
  native: 'com_ui_file_mode_native',
  search: 'com_ui_file_mode_search',
};

const ORDER: FileMode[] = ['auto', 'text', 'native', 'search'];

/** Maps a resolved `tool_resource` back to the user-facing mode it represents,
 * so Auto can show what it actually chose (e.g. "Авто · Текст"). */
const toolResourceToMode = (resource: EToolResources | undefined): Exclude<FileMode, 'auto'> => {
  if (resource === EToolResources.file_search) {
    return 'search';
  }
  if (resource === EToolResources.context) {
    return 'text';
  }
  return 'native';
};

/**
 * Toolbar control for how an attached document is handled (Auto / Text / Native
 * / Search). Only rendered when a non-image file is attached — images always go
 * to vision and need no choice. The selection applies to the next attachment
 * for this conversation (see `fileModeByConvoId` + `useFileHandling`).
 */
function FileMode() {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);
  const context = useBadgeRowContext();
  const chat = useChatContext();
  const conversationId = context?.conversationId ?? Constants.NEW_CONVO;
  const [mode, setMode] = useRecoilState(fileModeByConvoId(conversationId));

  /** The non-image files currently attached. Images are excluded — they're
   * always sent natively for vision and the control stays hidden for them. */
  const documentFiles = useMemo(() => {
    const files = chat?.files;
    if (!files) {
      return [];
    }
    return Array.from(files.values()).filter((file) => !isImageMimetype(file.type ?? ''));
  }, [chat?.files]);

  /** When Auto is active and exactly one document is attached, surface the
   * concrete choice Auto made; otherwise just show "Auto". */
  const resolvedAutoMode = useMemo<Exclude<FileMode, 'auto'> | null>(() => {
    if (mode !== 'auto' || documentFiles.length !== 1) {
      return null;
    }
    const file = documentFiles[0];
    const resource = resolveFileToolResource('auto', {
      mimetype: file.type ?? '',
      sizeBytes: file.size ?? 0,
    });
    return toolResourceToMode(resource);
  }, [mode, documentFiles]);

  if (documentFiles.length === 0) {
    return null;
  }

  const TriggerIcon = MODE_ICONS[mode];
  const baseLabel = localize(MODE_LABEL_KEYS[mode]);
  const label = resolvedAutoMode
    ? `${baseLabel} · ${localize(MODE_LABEL_KEYS[resolvedAutoMode])}`
    : baseLabel;

  const items: MenuItemProps[] = ORDER.map((value) => {
    const Icon = MODE_ICONS[value];
    return {
      label: localize(MODE_LABEL_KEYS[value]),
      onClick: () => setMode(value),
      icon: <Icon className="icon-md" />,
    };
  });

  const trigger = (
    <TooltipAnchor
      description={localize('com_ui_file_mode')}
      render={
        <Ariakit.MenuButton
          aria-label={localize('com_ui_file_mode')}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-full border border-border-medium px-3 text-sm',
            'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
            isOpen && 'bg-surface-hover',
          )}
        >
          <TriggerIcon className="icon-sm" />
          <span className="max-w-[12rem] truncate">{label}</span>
        </Ariakit.MenuButton>
      }
    />
  );

  return (
    <DropdownPopup
      menuId="file-mode-menu"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      trigger={trigger}
      items={items}
      modal={true}
      unmountOnHide={true}
    />
  );
}

export default memo(FileMode);
