import { X } from '~/components/icons';
import { useLocalize } from '~/hooks';

export default function RemoveFile({ onRemove }: { onRemove: () => void }) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      /* Fully INSIDE the card corner (14.08 review, находка 7): the old
         half-out translate poked 6px past the card edge, and inside the
         composer's overflow-x-auto file ribbon that overhang fed the same
         sideways-jitter class the tap-target fix killed — plus the top half
         was clipped by the scroller anyway. */
      className="absolute right-1 top-1 rounded-full bg-[var(--c-ink)] p-0.5 text-[var(--c-ink-label)] opacity-0 shadow-sm transition-opacity duration-150 focus-visible:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100"
      onClick={onRemove}
      aria-label={localize('com_ui_attach_remove')}
    >
      <X className="icon-sm" />
    </button>
  );
}
