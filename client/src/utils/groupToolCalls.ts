import { Constants, ContentTypes, ToolCallTypes, ASK_USER_TOOL } from 'librechat-data-provider';
import type { TMessageContentParts, Agents } from 'librechat-data-provider';
import type { PartWithIndex } from '~/components/Chat/Messages/Content/ParallelContent';

export type GroupedPart =
  | { type: 'single'; part: PartWithIndex }
  | { type: 'tool-group'; parts: PartWithIndex[] };

function isGroupableToolCall(part: TMessageContentParts): boolean {
  if (part.type !== ContentTypes.TOOL_CALL) {
    return false;
  }
  const toolCall = part[ContentTypes.TOOL_CALL] as Agents.ToolCall | undefined;
  if (!toolCall) {
    return false;
  }
  const isStandardToolCall =
    'args' in toolCall && (!toolCall.type || toolCall.type === ToolCallTypes.TOOL_CALL);
  if (isStandardToolCall && toolCall.name?.startsWith(Constants.LC_TRANSFER_TO_)) {
    return false;
  }
  /* The ask_user questions card is a user-facing control, not a tool chip —
   * swallowed into a collapsed ToolCallGroup it would simply not be seen
   * (r25: the model may call e.g. web_search and ask_user back to back). */
  if (isStandardToolCall && toolCall.name === ASK_USER_TOOL) {
    return false;
  }
  return true;
}

export function groupSequentialToolCalls(parts: PartWithIndex[]): GroupedPart[] {
  const result: GroupedPart[] = [];
  let currentGroup: PartWithIndex[] = [];

  const flushGroup = () => {
    if (currentGroup.length >= 2) {
      result.push({ type: 'tool-group', parts: [...currentGroup] });
    } else {
      for (const p of currentGroup) {
        result.push({ type: 'single', part: p });
      }
    }
    currentGroup = [];
  };

  for (const item of parts) {
    if (isGroupableToolCall(item.part)) {
      currentGroup.push(item);
    } else {
      flushGroup();
      result.push({ type: 'single', part: item });
    }
  }
  flushGroup();

  return result;
}
