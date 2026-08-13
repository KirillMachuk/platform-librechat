import { TooltipAnchor } from '@librechat/client';
import { Download } from '~/components/icons';
import { useLocalize } from '~/hooks';

/** The file card's ONE download affordance (owner 12.08-3, скрин Kimi/GPT):
 *  a bare glyph inside the card's right edge — no box of its own; the card
 *  paints the hover, the glyph only darkens. Revealed by the card's hover
 *  via the shared trailing slot. */
export default function CardDownloadButton({
  onClick,
  name,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  name?: string;
}) {
  const localize = useLocalize();
  const label = name ? `${localize('com_ui_download')} ${name}` : localize('com_ui_download');
  return (
    <TooltipAnchor
      description={localize('com_ui_download')}
      render={
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex size-8 items-center justify-center text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none"
        >
          <Download className="icon-md" aria-hidden="true" />
        </button>
      }
    />
  );
}
