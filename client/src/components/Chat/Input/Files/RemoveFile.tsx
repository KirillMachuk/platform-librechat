import { X } from '~/components/icons';
import { useLocalize } from '~/hooks';

export default function RemoveFile({ onRemove }: { onRemove: () => void }) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      className="absolute right-1 top-1 -translate-y-1/2 translate-x-1/2 rounded-full bg-[var(--c-ink)] p-0.5 text-[var(--c-ink-label)] opacity-0 shadow-sm transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      onClick={onRemove}
      aria-label={localize('com_ui_attach_remove')}
    >
      <X className="icon-sm" />
    </button>
  );
}
