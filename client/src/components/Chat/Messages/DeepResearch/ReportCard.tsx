import { useState, useRef, useEffect, useCallback } from 'react';
import { FileText, Maximize2 } from 'lucide-react';
import { Button, Dialog, DialogTitle, DialogHeader, DialogContent } from '@librechat/client';
import type { ReactNode } from 'react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type TocItem = { key: string; label: string; level: number; node: HTMLElement };

/** Indent depth for a rendered heading tag (h1→1, h2→2, else 3). */
function headingLevel(tag: string): number {
  if (tag === 'H1') {
    return 1;
  }
  if (tag === 'H2') {
    return 2;
  }
  return 3;
}

/**
 * The finished Deep Research report (task #21, phase 3): the chat shows a collapsed
 * preview card (header + clamped content with a fade + Развернуть/Скопировать), and
 * expanding opens a full-screen reader dialog with a table of contents built from the
 * RENDERED headings (no markdown re-parse — the children are the same ContentParts
 * element the message would render anyway; the PDF chip stays outside, unclamped).
 *
 * Review r2: while the reader is open the collapsed copy is `hidden` (not painted, and
 * closing needs no re-parse); on <md the TOC — previously absent on phones — renders as
 * a collapsible «Содержание» disclosure above the text; the scroll region is keyboard-
 * focusable so PageDown/arrows work without a mouse.
 */
export default function ReportCard({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: ReactNode;
}) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const mobileTocRef = useRef<HTMLDetailsElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const displayTitle = title || localize('com_ui_deep_research');

  const copy = useCallback(() => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }, [text]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    if (!open) {
      setToc([]);
      return;
    }
    const timer = setTimeout(() => {
      const nodes = contentRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3');
      setToc(
        Array.from(nodes ?? []).map((node, i) => ({
          key: `toc-${i}`,
          label: node.textContent ?? '',
          level: headingLevel(node.tagName),
          node,
        })),
      );
    }, 80);
    return () => clearTimeout(timer);
  }, [open]);

  const scrollToHeading = useCallback((node: HTMLElement) => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (mobileTocRef.current) {
      mobileTocRef.current.open = false;
    }
  }, []);

  const copyLabel = copied ? localize('com_ui_copied_to_clipboard') : localize('com_ui_copy');

  const tocList = (
    <ul className="space-y-1">
      {toc.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            onClick={() => scrollToHeading(item.node)}
            className="w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div className="my-2 w-full overflow-hidden rounded-2xl border border-border-light bg-surface-primary-alt">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2.5 border-b border-border-light px-4 py-3 text-left hover:bg-surface-hover"
          aria-label={localize('com_ui_expand')}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-submit text-white"
            aria-hidden="true"
          >
            <FileText className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
            {displayTitle}
          </span>
          <Maximize2 className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        </button>
        <div className={cn('relative max-h-80 overflow-hidden px-4 pt-2', open && 'hidden')}>
          {children}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-surface-primary-alt to-transparent"
            aria-hidden="true"
          />
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2">
          <Button variant="ghost" size="sm" onClick={copy}>
            {copyLabel}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {localize('com_ui_expand')}
          </Button>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={true}
          className="flex h-[88dvh] w-[min(96vw,56rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="border-b border-border-light px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-3 pr-10">
              <DialogTitle className="truncate text-base font-semibold text-text-primary">
                {displayTitle}
              </DialogTitle>
              <Button variant="ghost" size="sm" onClick={copy} className="shrink-0">
                {copyLabel}
              </Button>
            </div>
          </DialogHeader>
          {toc.length > 1 && (
            <details
              ref={mobileTocRef}
              className="border-b border-border-light px-4 py-2 md:hidden"
            >
              <summary className="cursor-pointer py-1 text-sm font-medium text-text-secondary">
                {localize('com_ui_deep_research_contents')}
              </summary>
              <div className="max-h-48 overflow-y-auto pb-1 pt-1">{tocList}</div>
            </details>
          )}
          <div className="flex min-h-0 flex-1">
            {toc.length > 1 && (
              <nav
                className="hidden w-60 shrink-0 overflow-y-auto border-r border-border-light p-3 md:block"
                aria-label={localize('com_ui_deep_research_contents')}
              >
                {tocList}
              </nav>
            )}
            <div
              ref={contentRef}
              tabIndex={0}
              role="region"
              aria-label={displayTitle}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-xheavy sm:px-8"
            >
              {children}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
