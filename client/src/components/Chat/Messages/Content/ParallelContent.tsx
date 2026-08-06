import { memo, useMemo, useState } from 'react';
import { useMediaQuery } from '@librechat/client';
import type { TMessageContentParts, SearchResultData, TAttachment } from 'librechat-data-provider';
import { useSiblingIdentity } from '~/hooks/Messages';
import { Segmented } from '~/components/ui/Segmented';
import MemoryArtifacts from './MemoryArtifacts';
import Sources from '~/components/Web/Sources';
import { SearchContext } from '~/Providers';
import SiblingHeader from './SiblingHeader';
import { useLocalize } from '~/hooks';
import { EmptyText } from './Parts';
import Container from './Container';
import { cn } from '~/utils';

export type PartWithIndex = { part: TMessageContentParts; idx: number };

export type ParallelColumn = {
  agentId: string;
  parts: PartWithIndex[];
};

export type ParallelSection = {
  groupId: number;
  columns: ParallelColumn[];
};

/**
 * Groups content parts by groupId for parallel rendering.
 * Parts with same groupId are displayed in columns, grouped by agentId.
 *
 * @param content - Array of content parts
 * @returns Object containing parallel sections and sequential parts
 */
export function groupParallelContent(
  content: Array<TMessageContentParts | undefined> | undefined,
): { parallelSections: ParallelSection[]; sequentialParts: PartWithIndex[] } {
  if (!content) {
    return { parallelSections: [], sequentialParts: [] };
  }

  const groupMap = new Map<number, PartWithIndex[]>();
  // Track placeholder agentIds per groupId (parts with empty type that establish columns)
  const placeholderAgents = new Map<number, Set<string>>();
  const noGroup: PartWithIndex[] = [];

  content.forEach((part, idx) => {
    if (!part) {
      return;
    }

    // Read metadata directly from content part (TMessageContentParts includes ContentMetadata)
    const { groupId } = part;

    // Check for placeholder (empty type) before narrowing - access agentId via casting
    const partAgentId = (part as { agentId?: string }).agentId;

    if (groupId != null) {
      // Track placeholder parts (empty type) to establish columns for pending agents
      if (!part.type && partAgentId) {
        if (!placeholderAgents.has(groupId)) {
          placeholderAgents.set(groupId, new Set());
        }
        placeholderAgents.get(groupId)!.add(partAgentId);
        return; // Don't add to groupMap - we'll handle these separately
      }

      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, []);
      }
      groupMap.get(groupId)!.push({ part, idx });
    } else {
      noGroup.push({ part, idx });
    }
  });

  // Collect all groupIds (from both real content and placeholders)
  const allGroupIds = new Set([...groupMap.keys(), ...placeholderAgents.keys()]);

  // Build parallel sections with columns grouped by agentId
  const sections: ParallelSection[] = [];
  for (const groupId of allGroupIds) {
    const columnMap = new Map<string, PartWithIndex[]>();
    const parts = groupMap.get(groupId) ?? [];

    for (const { part, idx } of parts) {
      // Read agentId directly from content part (TMessageContentParts includes ContentMetadata)
      const agentId = part.agentId ?? 'unknown';

      if (!columnMap.has(agentId)) {
        columnMap.set(agentId, []);
      }
      columnMap.get(agentId)!.push({ part, idx });
    }

    // Add empty columns for placeholder agents that don't have real content yet
    const groupPlaceholders = placeholderAgents.get(groupId);
    if (groupPlaceholders) {
      for (const placeholderAgentId of groupPlaceholders) {
        if (!columnMap.has(placeholderAgentId)) {
          // Empty array signals this column should show loading state
          columnMap.set(placeholderAgentId, []);
        }
      }
    }

    // Sort columns: primary agent (no ____N suffix) first, added agents (with suffix) second
    // This ensures consistent column ordering regardless of which agent responds first
    const sortedAgentIds = Array.from(columnMap.keys()).sort((a, b) => {
      const aHasSuffix = a.includes('____');
      const bHasSuffix = b.includes('____');
      if (aHasSuffix && !bHasSuffix) {
        return 1;
      }
      if (!aHasSuffix && bHasSuffix) {
        return -1;
      }
      return 0;
    });

    const columns = sortedAgentIds.map((agentId) => ({
      agentId,
      parts: columnMap.get(agentId)!,
    }));

    sections.push({ groupId, columns });
  }

  // Sort sections by the minimum index in each section (sections with only placeholders go last)
  sections.sort((a, b) => {
    const aParts = a.columns.flatMap((c) => c.parts.map((p) => p.idx));
    const bParts = b.columns.flatMap((c) => c.parts.map((p) => p.idx));
    const aMin = aParts.length > 0 ? Math.min(...aParts) : Infinity;
    const bMin = bParts.length > 0 ? Math.min(...bParts) : Infinity;
    return aMin - bMin;
  });

  return { parallelSections: sections, sequentialParts: noGroup };
}

type ParallelColumnsProps = {
  columns: ParallelColumn[];
  groupId: number;
  messageId: string;
  createdAt?: string | null;
  isSubmitting: boolean;
  lastContentIdx: number;
  conversationId?: string | null;
  renderPart: (part: TMessageContentParts, idx: number, isLastPart: boolean) => React.ReactNode;
};

/**
 * Renders parallel content columns for a single groupId.
 *
 * Side by side on a desktop; on a phone one at a time, switched by a segment.
 * Stacking them there looked simpler and was not: the answers ended up some six
 * hundred pixels apart, so comparing them — the only reason they exist — meant
 * scrolling past one to reach the other and holding it in your head.
 */
export const ParallelColumns = memo(function ParallelColumns({
  columns,
  groupId,
  messageId,
  createdAt,
  conversationId,
  isSubmitting,
  lastContentIdx,
  renderPart,
}: ParallelColumnsProps) {
  const localize = useLocalize();
  const isPhone = useMediaQuery('(max-width: 767px)');
  const [shown, setShown] = useState(0);

  /* A column can arrive or leave mid-stream; without this the segment could point
     past the end and the phone would show nothing at all. */
  const active = Math.min(shown, Math.max(columns.length - 1, 0));
  const columnId = (index: number) => `parallel-${messageId}-${groupId}-${index}`;

  return (
    <>
      {isPhone && columns.length > 1 && (
        <SiblingSwitcher
          columns={columns}
          active={active}
          onChange={setShown}
          label={localize('com_ui_switch_answer')}
          panelId={columnId}
        />
      )}
      <div className={cn('flex w-full flex-col gap-3 md:flex-row', 'sibling-content-group')}>
        {columns.map(({ agentId, parts: columnParts }, colIdx) => {
          // Show loading cursor if column has no content parts yet (empty array from placeholder)
          const showLoadingCursor = isSubmitting && columnParts.length === 0;
          const hidden = isPhone && columns.length > 1 && colIdx !== active;

          return (
            <div
              key={`column-${messageId}-${groupId}-${agentId || colIdx}`}
              id={columnId(colIdx)}
              role={isPhone && columns.length > 1 ? 'tabpanel' : undefined}
              className={cn(
                'min-w-0 flex-1 rounded-xl border border-border-light p-3',
                hidden && 'hidden',
              )}
            >
              <SiblingHeader
                agentId={agentId}
                messageId={messageId}
                createdAt={createdAt}
                isSubmitting={isSubmitting}
                conversationId={conversationId}
                parts={columnParts.map(({ part }) => part)}
                nameInSwitcher={isPhone && columns.length > 1}
              />
              {showLoadingCursor ? (
                <Container>
                  <EmptyText />
                </Container>
              ) : (
                columnParts.map(({ part, idx }) => {
                  const isLastInColumn = idx === columnParts[columnParts.length - 1]?.idx;
                  const isLastContent = idx === lastContentIdx;
                  return renderPart(part, idx, isLastInColumn && isLastContent);
                })
              )}
            </div>
          );
        })}
      </div>
    </>
  );
});

/** Names every column so the segment can say which answer it switches to. */
function SiblingSwitcher({
  columns,
  active,
  onChange,
  label,
  panelId,
}: {
  columns: ParallelColumn[];
  active: number;
  onChange: (index: number) => void;
  label: string;
  panelId: (index: number) => string;
}) {
  const items = columns.map((column, index) => ({
    id: String(index),
    label: <SiblingName agentId={column.agentId} />,
  }));

  return (
    <Segmented
      items={items}
      value={String(active)}
      onChange={(id) => onChange(Number(id))}
      label={label}
      panelId={(id) => panelId(Number(id))}
      className="mb-3"
    />
  );
}

function SiblingName({ agentId }: { agentId?: string }) {
  return <>{useSiblingIdentity(agentId).displayName}</>;
}

type ParallelContentRendererProps = {
  content?: Array<TMessageContentParts | undefined>;
  messageId: string;
  createdAt?: string | null;
  conversationId?: string | null;
  attachments?: TAttachment[];
  searchResults?: { [key: string]: SearchResultData };
  isSubmitting: boolean;
  renderPart: (part: TMessageContentParts, idx: number, isLastPart: boolean) => React.ReactNode;
};

/**
 * Renders content with parallel sections (columns) and sequential parts.
 * Handles the layout of before/parallel/after content sections.
 */
export const ParallelContentRenderer = memo(function ParallelContentRenderer({
  content,
  messageId,
  createdAt,
  conversationId,
  attachments,
  searchResults,
  isSubmitting,
  renderPart,
}: ParallelContentRendererProps) {
  const { parallelSections, sequentialParts } = useMemo(
    () => groupParallelContent(content),
    [content],
  );

  const lastContentIdx = (content?.length ?? 0) - 1;

  // Split sequential parts into before/after parallel sections
  const { before, after } = useMemo(() => {
    if (parallelSections.length === 0) {
      return { before: sequentialParts, after: [] };
    }

    const allParallelIndices = parallelSections.flatMap((s) =>
      s.columns.flatMap((c) => c.parts.map((p) => p.idx)),
    );
    const minParallelIdx = Math.min(...allParallelIndices);
    const maxParallelIdx = Math.max(...allParallelIndices);

    return {
      before: sequentialParts.filter(({ idx }) => idx < minParallelIdx),
      after: sequentialParts.filter(({ idx }) => idx > maxParallelIdx),
    };
  }, [parallelSections, sequentialParts]);

  return (
    <SearchContext.Provider value={{ searchResults }}>
      <MemoryArtifacts attachments={attachments} />
      <Sources messageId={messageId} conversationId={conversationId || undefined} />

      {/* Sequential content BEFORE parallel sections */}
      {before.map(({ part, idx }) => renderPart(part, idx, false))}

      {/* Parallel sections - each group renders as columns */}
      {parallelSections.map(({ groupId, columns }) => (
        <ParallelColumns
          key={`parallel-group-${messageId}-${groupId}`}
          columns={columns}
          groupId={groupId}
          messageId={messageId}
          createdAt={createdAt}
          renderPart={renderPart}
          isSubmitting={isSubmitting}
          conversationId={conversationId}
          lastContentIdx={lastContentIdx}
        />
      ))}

      {/* Sequential content AFTER parallel sections */}
      {after.map(({ part, idx }) => renderPart(part, idx, idx === lastContentIdx))}
    </SearchContext.Provider>
  );
});

export default ParallelContentRenderer;
