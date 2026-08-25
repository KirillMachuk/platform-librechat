import React, { memo, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { getRemarkPlugins, getRehypePlugins, getMarkdownComponents } from './markdownConfig';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import ThinkingIndicator from './ThinkingIndicator';
import MarkdownBlocks from './MarkdownBlocks';
import { preprocessLaTeX } from '~/utils';
import store from '~/store';

type TContentProps = {
  content: string;
  isLatestMessage: boolean;
};

const Markdown = memo(function Markdown({ content = '', isLatestMessage }: TContentProps) {
  const LaTeXParsing = useRecoilValue<boolean>(store.LaTeXParsing);
  const isInitializing = content === '';

  const currentContent = useMemo(() => {
    if (isInitializing) {
      return '';
    }
    return LaTeXParsing ? preprocessLaTeX(content) : content;
  }, [content, LaTeXParsing, isInitializing]);

  if (isInitializing) {
    /* In-flow, direct child of the caller's `.prose` wrapper — same geometry
     * as the reply's first paragraph, so the first token replaces the label
     * in place instead of painting 20px above it (see EmptyText). */
    return <p className="relative">{isLatestMessage && <ThinkingIndicator />}</p>;
  }

  return (
    <MarkdownErrorBoundary content={content} codeExecution={true}>
      <MarkdownBlocks
        content={currentContent}
        remarkPlugins={getRemarkPlugins()}
        rehypePlugins={getRehypePlugins()}
        components={getMarkdownComponents()}
      />
    </MarkdownErrorBoundary>
  );
});
Markdown.displayName = 'Markdown';

export default Markdown;
