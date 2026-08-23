import { Constants } from 'librechat-data-provider';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { LCAvailableTools, ParsedServerConfig } from './types';
import { filterMCPToolFunctions, filterMCPTools, isMCPToolAllowed } from './allowlist';

const config = {
  type: 'streamable-http',
  url: 'https://mcp.example.com',
  allowedTools: ['search_files', 'read_file_content'],
} as ParsedServerConfig;

describe('MCP tool allowlist', () => {
  it('preserves backwards compatibility when no allowlist is configured', () => {
    const unrestricted = { ...config, allowedTools: undefined };

    expect(isMCPToolAllowed(unrestricted, 'create_file')).toBe(true);
  });

  it('denies tools not explicitly listed and treats an empty list as deny-all', () => {
    expect(isMCPToolAllowed(config, 'search_files')).toBe(true);
    expect(isMCPToolAllowed(config, 'create_file')).toBe(false);
    expect(isMCPToolAllowed({ ...config, allowedTools: [] }, 'search_files')).toBe(false);
  });

  it('filters discovered MCP tools', () => {
    const tools = [
      { name: 'search_files' },
      { name: 'read_file_content' },
      { name: 'create_file' },
    ] as Tool[];

    expect(filterMCPTools(tools, config)?.map((tool) => tool.name)).toEqual([
      'search_files',
      'read_file_content',
    ]);
  });

  it('filters cached tool definitions using raw MCP tool names', () => {
    const suffix = `${Constants.mcp_delimiter}google-drive`;
    const tools = Object.fromEntries(
      ['search_files', 'read_file_content', 'create_file'].map((name) => [
        `${name}${suffix}`,
        {
          type: 'function',
          function: {
            name: `${name}${suffix}`,
            description: name,
            parameters: { type: 'object', properties: {} },
          },
        },
      ]),
    ) as LCAvailableTools;

    expect(Object.keys(filterMCPToolFunctions('google-drive', tools, config))).toEqual([
      `search_files${suffix}`,
      `read_file_content${suffix}`,
    ]);
  });
});
