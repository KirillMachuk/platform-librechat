import { ContentTypes, ASK_USER_TOOL } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { PartWithIndex } from '~/components/Chat/Messages/Content/ParallelContent';
import { groupSequentialToolCalls } from '../groupToolCalls';

const toolCall = (name: string): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    tool_call: { id: `call-${name}`, name, args: '{}' },
  }) as unknown as TMessageContentParts;

const withIndex = (parts: TMessageContentParts[]): PartWithIndex[] =>
  parts.map((part, idx) => ({ part, idx }));

describe('groupSequentialToolCalls — ask_user stays out of collapsed groups (r25)', () => {
  it('groups plain sequential tool calls', () => {
    const grouped = groupSequentialToolCalls(
      withIndex([toolCall('web_search'), toolCall('file_search')]),
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].type).toBe('tool-group');
  });

  it('an ask_user between two tools breaks the group and stays single', () => {
    /* Swallowed into a collapsed ToolCallGroup the questions card would
     * simply not be seen — the model may search and then ask back to back. */
    const grouped = groupSequentialToolCalls(
      withIndex([toolCall('web_search'), toolCall(ASK_USER_TOOL), toolCall('file_search')]),
    );
    const singles = grouped.filter((g) => g.type === 'single');
    expect(
      singles.some(
        (g) =>
          g.type === 'single' &&
          (g.part.part[ContentTypes.TOOL_CALL] as { name?: string })?.name === ASK_USER_TOOL,
      ),
    ).toBe(true);
    expect(grouped.some((g) => g.type === 'tool-group')).toBe(false);
  });
});
