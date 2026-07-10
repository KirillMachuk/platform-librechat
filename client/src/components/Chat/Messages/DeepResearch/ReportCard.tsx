import { useState, useRef, useEffect, useCallback } from 'react';
import { FileText, Maximize2 } from 'lucide-react';
import { Button, Dialog, DialogTitle, DialogHeader, DialogContent } from '@librechat/client';
import type { ReactNode } from 'react';
import { useLocalize } from '~/hooks';

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
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const copyLabel = copied ? localize('com_ui_copied_to_clipboard') : localize('com_ui_copy');

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
            {title}
          </span>
          <Maximize2 className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        </button>
        <div className="relative max-h-80 overflow-hidden px-4 pt-2">
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
                {title}
              </DialogTitle>
              <Button variant="ghost" size="sm" onClick={copy} className="shrink-0">
                {copyLabel}
              </Button>
            </div>
          </DialogHeader>
          <div className="flex min-h-0 flex-1">
            {toc.length > 1 && (
              <nav
                className="hidden w-60 shrink-0 overflow-y-auto border-r border-border-light p-3 md:block"
                aria-label={localize('com_ui_deep_research_contents')}
              >
                <ul className="space-y-1">
                  {toc.map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() =>
                          item.node.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }
                        className="w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                        style={{ paddingLeft: `${8 + (item.level - 1) * 12}px` }}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8">
              {children}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
