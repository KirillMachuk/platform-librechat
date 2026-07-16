import { parseToolName, getToolDisplayLabel } from './toolLabels';

const identityLocalize = ((key: string) => key) as unknown as Parameters<
  typeof getToolDisplayLabel
>[1];

describe('toolLabels — library_search identity', () => {
  it('maps library_search to the file_search friendly label (reuses file-search UI)', () => {
    const parsed = parseToolName('library_search');
    expect(parsed.friendlyKey).toBe('com_ui_tool_name_file_search');
    expect(parsed.mcpServer).toBe('');
    expect(getToolDisplayLabel('library_search', identityLocalize)).toBe(
      'com_ui_tool_name_file_search',
    );
  });

  it('keeps file_search and retrieval on the same friendly label', () => {
    expect(parseToolName('file_search').friendlyKey).toBe('com_ui_tool_name_file_search');
    expect(parseToolName('retrieval').friendlyKey).toBe('com_ui_tool_name_file_search');
  });

  it('leaves unknown tool names without a friendly key (raw fallback)', () => {
    const parsed = parseToolName('some_unknown_tool');
    expect(parsed.friendlyKey).toBeUndefined();
    expect(getToolDisplayLabel('some_unknown_tool', identityLocalize)).toBe('some_unknown_tool');
  });
});
