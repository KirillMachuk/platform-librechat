import React, { ReactNode, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { VisuallyHidden } from '@ariakit/react';
import { ChevronDown, FileText, Globe } from '~/components/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export interface SourceData {
  link: string;
  title?: string;
  attribution?: string;
  snippet?: string;
}

interface SourceHovercardProps {
  source: SourceData;
  label: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  isFile?: boolean;
  isLocalFile?: boolean;
  children?: ReactNode;
  filePages?: number[];
  fileRelevance?: number;
}

function getFaviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

export function getCleanDomain(url: string) {
  const domain = url.replace(/(^\w+:|^)\/\//, '').split('/')[0];
  return domain.startsWith('www.') ? domain.substring(4) : domain;
}

export function FaviconImage({ domain, className = '' }: { domain: string; className?: string }) {
  /**
   * The icon is not ours: the browser fetches it from an external service, and
   * that answer arrives through a redirect — measured at ~0.8s per icon, with
   * some domains answering 404 and never producing one at all. So the row's
   * text was on screen while its icons were still empty holes, which read as
   * broken (owner r28).
   *
   * The box is therefore never empty: a neutral glyph holds it until the real
   * icon has actually decoded, and stays for good when it never arrives. The
   * placeholder is REPLACED rather than layered under the image — these icons
   * are PNGs with transparent corners, and a glyph behind one shows through it
   * permanently.
   *
   * `loading="lazy"` stays. It is not what makes the icon late (an in-viewport
   * image is fetched as soon as layout knows about it); it is what keeps a
   * collapsed list of sources — which lives in the DOM at zero height — from
   * firing a request per source the moment the message renders.
   *
   * Decorative by contract: every call site sets the favicon beside the domain
   * or source name in text, so a non-empty alt only doubles the accessible
   * name («example.com example.com» — caught by the suite).
   */
  const [shown, setShown] = useState(false);
  return (
    <span className={cn('relative inline-flex size-4 shrink-0', className)}>
      {!shown && (
        <Globe className="absolute inset-0 size-full text-text-tertiary opacity-60" aria-hidden />
      )}
      <img
        src={getFaviconUrl(domain)}
        alt=""
        className={cn('size-full rounded-full', !shown && 'opacity-0')}
        loading="lazy"
        onLoad={() => setShown(true)}
      />
    </span>
  );
}

/* The floating source card (GPT pattern, owner 11.08): card fill, hairline
 * edge, radius 12, the one floating shadow — canon §4/§2. */
const hovercardClass = cn(
  'z-popover w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border border-border-light bg-surface-primary p-3 text-text-primary shadow-lg',
  'origin-top -translate-y-1 opacity-0 transition-[opacity,transform] duration-150 ease-out',
  'data-[enter]:translate-y-0 data-[enter]:opacity-100',
  'data-[leave]:-translate-y-1 data-[leave]:opacity-0',
);

/* The in-text citation chip (GPT pattern the owner sent 11.08): a quiet
 * fully-round pill — favicon (or file glyph) + name + «+N» — sitting at the
 * end of the sentence it backs. Canon §6.13 sources: hairline pill; 12.5px
 * per the §3 caption step; no visible chevron — the card opens on hover, and
 * for the keyboard the Ariakit disclosure below stays reachable unseen. */
export const citationChipClass = cn(
  'ml-1 inline-flex h-[22px] max-w-40 items-center overflow-hidden text-ellipsis whitespace-nowrap',
  'rounded-full border border-border-light bg-surface-secondary px-2 align-[2px]',
  'text-[12.5px] leading-none text-text-secondary no-underline',
  'transition-colors hover:bg-surface-hover hover:text-text-primary',
);

function FileHovercardContent({
  source,
  onClick,
  filePages,
  fileRelevance,
}: {
  source: SourceData;
  onClick?: (e: React.MouseEvent) => void;
  filePages?: number[];
  fileRelevance?: number;
}) {
  const localize = useLocalize();
  const fileName = source.attribution || source.title || localize('com_file_source');

  return (
    <>
      <div className="flex items-center gap-2">
        <FileText className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <button
          onClick={onClick}
          className="min-w-0 truncate text-sm font-medium text-text-primary hover:underline"
        >
          {fileName}
        </button>
      </div>
      {(fileRelevance != null || (filePages && filePages.length > 0)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {fileRelevance != null && fileRelevance > 0 && (
            <span className="text-xs text-text-secondary">
              {localize('com_ui_relevance')}: {Math.round(fileRelevance * 100)}%
            </span>
          )}
          {filePages && filePages.length > 0 && (
            <span className="text-xs text-text-secondary">
              {localize('com_file_pages', { pages: filePages.join(', ') })}
            </span>
          )}
        </div>
      )}
      {source.snippet && (
        <p className="mt-1.5 line-clamp-3 break-words text-xs leading-relaxed text-text-secondary">
          {source.snippet}
        </p>
      )}
    </>
  );
}

export function SourceHovercard({
  source,
  label,
  onMouseEnter,
  onMouseLeave,
  onClick,
  isFile = false,
  isLocalFile = false,
  children,
  filePages,
  fileRelevance,
}: SourceHovercardProps) {
  const localize = useLocalize();
  const domain = getCleanDomain(source.link || '');
  const hovercard = Ariakit.useHovercardStore({ showTimeout: 150, hideTimeout: 150 });

  const handleFileClick = React.useCallback(
    (e: React.MouseEvent) => {
      hovercard.hide();
      onClick?.(e);
    },
    [hovercard, onClick],
  );

  return (
    <span className="relative ml-0.5 inline-block">
      <Ariakit.HovercardProvider store={hovercard}>
        <span className="inline-flex items-center">
          <Ariakit.HovercardAnchor
            render={
              isFile ? (
                <button
                  onClick={handleFileClick}
                  className={cn(citationChipClass, 'cursor-pointer')}
                  onMouseEnter={onMouseEnter}
                  onMouseLeave={onMouseLeave}
                >
                  <span className="truncate">{label}</span>
                </button>
              ) : (
                <a
                  href={source.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={citationChipClass}
                  onMouseEnter={onMouseEnter}
                  onMouseLeave={onMouseLeave}
                >
                  <span className="truncate">{label}</span>
                </a>
              )
            }
          />
          {/* Keyboard door to the card: invisible until it owns focus (GPT
           * draws no chevron; a11y keeps the path). */}
          <Ariakit.HovercardDisclosure className="size-0 overflow-hidden rounded-full text-text-primary focus-visible:ml-0.5 focus-visible:size-auto">
            <VisuallyHidden>{localize('com_citation_more_details', { label })}</VisuallyHidden>
            <ChevronDown className="icon-sm" aria-hidden="true" />
          </Ariakit.HovercardDisclosure>

          <Ariakit.Hovercard
            gutter={16}
            className={hovercardClass}
            portal={true}
            unmountOnHide={true}
          >
            <div>
              {children ??
                (isFile ? (
                  <FileHovercardContent
                    source={source}
                    onClick={handleFileClick}
                    filePages={filePages}
                    fileRelevance={fileRelevance}
                  />
                ) : (
                  <>
                    {/* GPT's card order: who — favicon + domain up top, then
                     * WHAT — the title as the link, then the excerpt. */}
                    <div className="mb-1.5 flex items-center gap-2">
                      <FaviconImage domain={domain} />
                      <span className="min-w-0 truncate text-[12.5px] text-text-secondary">
                        {domain}
                      </span>
                    </div>
                    <a
                      href={source.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-medium text-text-primary hover:underline"
                    >
                      {source.title || source.link}
                    </a>
                    {source.snippet && (
                      <p className="mt-1.5 line-clamp-4 break-words text-[12.5px] leading-5 text-text-secondary">
                        {source.snippet}
                      </p>
                    )}
                  </>
                ))}
              {isLocalFile && (
                <p className="mt-1.5 text-xs text-text-secondary">
                  {localize('com_sources_download_local_unavailable')}
                </p>
              )}
            </div>
          </Ariakit.Hovercard>
        </span>
      </Ariakit.HovercardProvider>
    </span>
  );
}
