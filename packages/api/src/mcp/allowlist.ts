import { Constants } from 'librechat-data-provider';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { LCAvailableTools, ParsedServerConfig } from './types';

type ToolAllowlistConfig = Pick<ParsedServerConfig, 'allowedTools'> | undefined;

export function isMCPToolAllowed(config: ToolAllowlistConfig, toolName: string): boolean {
  if (config?.allowedTools == null) {
    return true;
  }
  return config.allowedTools.includes(toolName);
}

export function filterMCPTools<T extends Pick<Tool, 'name'>>(
  tools: T[] | null,
  config: ToolAllowlistConfig,
): T[] | null {
  if (tools == null || config?.allowedTools == null) {
    return tools;
  }
  const allowedTools = new Set(config.allowedTools);
  return tools.filter((tool) => allowedTools.has(tool.name));
}

export function filterMCPToolFunctions(
  serverName: string,
  tools: LCAvailableTools,
  config: ToolAllowlistConfig,
): LCAvailableTools {
  if (config?.allowedTools == null) {
    return tools;
  }

  const allowedTools = new Set(config.allowedTools);
  const suffix = `${Constants.mcp_delimiter}${serverName}`;
  return Object.fromEntries(
    Object.entries(tools).filter(([key, definition]) => {
      const name = definition.function.name || key;
      const rawName = name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
      return allowedTools.has(rawName);
    }),
  );
}
