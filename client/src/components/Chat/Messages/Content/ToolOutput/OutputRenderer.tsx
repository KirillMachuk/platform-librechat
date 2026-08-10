import { useState, useMemo, useCallback } from 'react';
import copy from 'copy-to-clipboard';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ContentBlock {
  type?: string;
  text?: string;
}

const ERROR_PREFIX = /^Error:\s*(\[.*?\]\s*)*tool call failed:\s*/i;
const ERROR_INNER = /^Error\s+\w+ing to endpoint\s*\(HTTP \d+\):\s*/i;

function cleanError(text: string): string {
  let cleaned = text.replace(ERROR_PREFIX, '').trim();
  cleaned = cleaned.replace(ERROR_INNER, '').trim();
  if (cleaned.endsWith('Please fix your mistakes.')) {
    cleaned = cleaned.slice(0, -'Please fix your mistakes.'.length).trim();
  }
  return cleaned;
}

export function isError(text: string): boolean {
  return ERROR_PREFIX.test(text) || text.startsWith('Error processing tool');
}

function isStructuredText(text: string): boolean {
  return text.includes('\n') || text.includes('{') || text.includes(':');
}

interface ExtractedText {
  text: string;
  rawError: string;
  error: boolean;
  /** When true, `text` contains raw JSON that should be rendered as a highlighted code block. */
  isJson: boolean;
}

function extractText(raw: string): ExtractedText {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { text: '', rawError: '', error: false, isJson: false };
  }

  if (isError(trimmed)) {
    return { text: cleanError(trimmed), rawError: trimmed, error: true, isJson: false };
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        const textBlocks = parsed.filter(
          (b: ContentBlock) => typeof b === 'object' && b !== null && typeof b.text === 'string',
        );
        if (textBlocks.length > 0) {
          const joined = (textBlocks as ContentBlock[])
            .map((b) => b.text)
            .join('\n')
            .trim();
          if (isError(joined)) {
            return { text: cleanError(joined), rawError: joined, error: true, isJson: false };
          }
          return { text: joined, rawError: '', error: false, isJson: false };
        }
      }

      // Render structured JSON as a highlighted code block
      return {
        text: JSON.stringify(parsed, null, 2),
        rawError: '',
        error: false,
        isJson: true,
      };
    } catch {
      // Not JSON
    }
  }

  return { text: trimmed, rawError: '', error: false, isJson: false };
}

const TRUNCATE_LINES = 20;
const VISIBLE_LINES = 15;

interface OutputRendererProps {
  text: string;
  /**
   * 'document' renders non-error text in the Inter reading style regardless
   * of the `isStructuredText` heuristic. The heuristic exists for TOOL output
   * (JSON-ish payloads read better mono), but it classifies virtually any
   * document as structured too — a colon or a newline is all it takes — which
   * put file-search snippets, i.e. the client's own CSV and docx TEXT, into
   * monospace. Canon §6.15: file content reads in the Inter scale; mono is
   * for code.
   */
  variant?: 'auto' | 'document';
}

export default function OutputRenderer({ text, variant = 'auto' }: OutputRendererProps) {
  const localize = useLocalize();
  const { text: displayText, rawError, error, isJson } = useMemo(() => extractText(text), [text]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(() => {
    setIsCopied(true);
    copy(displayText, { format: 'text/plain' });
    setTimeout(() => setIsCopied(false), 3000);
  }, [displayText]);

  if (!displayText) {
    return null;
  }

  const lines = displayText.split('\n');
  const needsTruncation = lines.length > TRUNCATE_LINES;
  const visibleText =
    needsTruncation && !isExpanded ? lines.slice(0, VISIBLE_LINES).join('\n') : displayText;
  const structured = variant !== 'document' && !isJson && isStructuredText(displayText);

  return (
    <div className="relative">
      {isJson ? (
        <pre className="max-h-[300px] overflow-auto rounded text-[12.5px] leading-5">
          <code className="hljs language-json !whitespace-pre-wrap !break-words">
            {visibleText}
          </code>
        </pre>
      ) : (
        <pre
          /* The inner-card scale the owner sent from GPT (10.08 late):
             tool output in mono 12.5/20; the client's own document text in
             Inter 13/20 — a quote, not a terminal. */
          className={cn(
            'max-h-[300px] overflow-auto whitespace-pre-wrap break-words',
            error && 'font-mono text-[12.5px] leading-5 text-red-600 dark:text-red-400',
            !error && structured && 'font-mono text-[12.5px] leading-5 text-text-secondary',
            !error && !structured && 'font-sans text-[13px] leading-5 text-text-primary',
          )}
        >
          {visibleText}
        </pre>
      )}
      <div className="absolute bottom-0 right-0">
        <CopyButton
          isCopied={isCopied}
          onClick={handleCopy}
          iconOnly
          label={localize('com_ui_copy')}
        />
      </div>
      {needsTruncation && (
        <button
          type="button"
          className="mt-1 text-xs text-text-secondary underline focus-visible:outline-none"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? localize('com_ui_show_less') : localize('com_ui_show_more')}
        </button>
      )}
      {error && rawError && rawError !== displayText && (
        <button
          type="button"
          className="mt-1 block text-xs text-text-secondary underline focus-visible:outline-none"
          onClick={() => setShowErrorDetails((prev) => !prev)}
        >
          {localize('com_ui_details')}
        </button>
      )}
      {showErrorDetails && rawError && (
        <pre className="mt-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-red-600 dark:text-red-400">
          {rawError}
        </pre>
      )}
    </div>
  );
}
