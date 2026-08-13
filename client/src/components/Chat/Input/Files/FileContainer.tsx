import type { TFile } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { ExtendedFile } from '~/common';
import { getFileType, cn } from '~/utils';
import { fileTypeMeta } from './typeMeta';
import FilePreview from './FilePreview';
import { useLocalize } from '~/hooks';
import RemoveFile from './RemoveFile';

const FileContainer = ({
  file,
  overrideType,
  displayName,
  subtitle,
  buttonClassName,
  containerClassName,
  onDelete,
  onClick,
  trailing,
}: {
  file: Partial<ExtendedFile | TFile>;
  overrideType?: string;
  /**
   * Optional pre-computed label for the chip. Callers in code-execution
   * artifact contexts pass the de-suffixed name; upload chips and
   * persisted user files leave this undefined and render the raw filename.
   */
  displayName?: string;
  /**
   * Optional override for the subtitle line (defaults to the file
   * type's localized title — e.g. "PowerPoint Presentation"). Used by
   * the deferred-preview flow to surface "Preparing preview…" /
   * "Preview unavailable" inline within the chip rather than as a
   * loose-feeling annotation below it. Pass a ReactNode so callers
   * can include icons (spinner, alert) alongside the text.
   */
  subtitle?: ReactNode;
  buttonClassName?: string;
  containerClassName?: string;
  onDelete?: () => void;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Rendered at the card's right edge, revealed on hover/focus — the chat
   *  passes its download button here (owner 12.08-2, скрины 3-4). */
  trailing?: ReactNode;
}) => {
  const localize = useLocalize();
  const fileType = getFileType(overrideType ?? file.type);
  const typeLabel = localize(fileTypeMeta(overrideType ?? file.type ?? '').labelKey);
  const visibleName = displayName ?? file.filename ?? '';

  return (
    <div
      className={cn('group relative inline-block text-sm text-text-primary', containerClassName)}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={visibleName}
        className={cn(
          /* Канон §6.13 ред. 12.08-2: карточка файла — card + hairline, под
             курсором hover; серых заливок в покое больше нет. */
          'relative overflow-hidden rounded-xl border border-border-light bg-surface-primary transition-colors',
          '[@media(hover:hover)]:group-hover:bg-surface-hover',
          buttonClassName,
        )}
      >
        <div className="w-56 p-1.5">
          <div className="flex flex-row items-center gap-2">
            <FilePreview file={file} fileType={fileType} className="relative" />
            <div className="overflow-hidden">
              <div className="truncate font-medium" title={visibleName}>
                {visibleName}
              </div>
              {subtitle != null ? (
                subtitle
              ) : (
                <div className="truncate text-text-secondary" title={typeLabel}>
                  {typeLabel}
                </div>
              )}
            </div>
          </div>
        </div>
      </button>
      {trailing != null && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          {trailing}
        </span>
      )}
      {onDelete && <RemoveFile onRemove={onDelete} />}
    </div>
  );
};

export default FileContainer;
