import { X } from 'lucide-react';
import { useLocalize } from '~/hooks';

export default function RemoveFile({ onRemove }: { onRemove: () => void }) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      className="absolute right-1 top-1 -translate-y-1/2 translate-x-1/2 rounded-full bg-surface-secondary p-0.5 transition-colors duration-200 hover:bg-surface-primary"
      onClick={onRemove}
      aria-label={localize('com_ui_attach_remove')}
    >
      <X className="icon-sm" />
    </button>
  );
}
