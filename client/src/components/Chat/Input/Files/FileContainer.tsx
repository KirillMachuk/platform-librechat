import type { TFile } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { ExtendedFile } from '~/common';
import { fileTypeMeta, fileBadge } from './typeMeta';
import FilePreview from './FilePreview';
import { useLocalize } from '~/hooks';
import RemoveFile from './RemoveFile';
import { cn } from '~/utils';

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
  pressed,
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
  /** Toggle semantics for cards that open a panel (the artifact card):
   *  aria-pressed mirrors «открытая держит серый». */
  pressed?: boolean;
}) => {
  const localize = useLocalize();
  const typeLabel = localize(fileTypeMeta(overrideType ?? file.type ?? '').labelKey);
  const visibleName = displayName ?? file.filename ?? '';
  /* 12.08-3, владелец: вторая строка — расширение + вес («DOCX 18.5 KB»);
     когда ни того ни другого не знаем, остаётся имя типа. bytes лежит в
     TFile.bytes у сохранённых файлов и в ExtendedFile.size у загружаемых. */
  const { extension, size } = fileBadge(
    file.filename,
    (file as { bytes?: number }).bytes ?? (file as { size?: number }).size,
  );
  const badge = [extension, size].filter(Boolean).join(' ');

  return (
    <div
      className={cn(
        'group/card relative inline-block text-sm text-text-primary',
        containerClassName,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={pressed}
        aria-label={visibleName}
        className={cn(
          /* Канон §6.13 ред. 12.08-2: карточка файла — card + hairline, под
             курсором hover; серых заливок в покое больше нет. */
          'relative overflow-hidden rounded-xl border border-border-light bg-surface-primary transition-colors',
          '[@media(hover:hover)]:group-hover/card:bg-surface-hover',
          buttonClassName,
        )}
      >
        <div className="w-64 p-1.5">
          {/* 14.08-4, владелец: у кнопки скачивания СВОЁ место — текст обязан
              обрезаться ДО зоны глифа, карточка длиннее (референс — второй
              скрин ChatGPT). pr-9 резервирует ровно зону trailing (32px глиф
              + зазор), поэтому наложение невозможно на любой ширине. */}
          <div className={cn('flex flex-row items-center gap-2', trailing != null && 'pr-9')}>
            <FilePreview file={file} overrideType={overrideType} className="relative" />
            <div className="overflow-hidden">
              <div className="truncate font-medium" title={visibleName}>
                {visibleName}
              </div>
              {subtitle != null ? (
                subtitle
              ) : (
                <div className="truncate text-text-secondary" title={badge || typeLabel}>
                  {badge || typeLabel}
                </div>
              )}
            </div>
          </div>
        </div>
      </button>
      {trailing != null && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100">
          {trailing}
        </span>
      )}
      {onDelete && <RemoveFile onRemove={onDelete} />}
    </div>
  );
};

export default FileContainer;
