import { Constants, ContentTypes } from 'librechat-data-provider';
import type { Agents, TMessageContentParts } from 'librechat-data-provider';

const OAUTH_TOOL_CALL_PREFIX = `oauth${Constants.mcp_delimiter}`;

type PersistableAbortContentPart = Agents.MessageContentComplex | TMessageContentParts;
type AbortContentPart = PersistableAbortContentPart | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function getTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value) && typeof value.value === 'string') {
    return value.value;
  }
  return '';
}

function getToolCall(part: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(part.tool_call)) {
    return part.tool_call;
  }

  const keyedToolCall = part[ContentTypes.TOOL_CALL];
  return isRecord(keyedToolCall) ? keyedToolCall : null;
}

function isOAuthPromptContentPart(part: AbortContentPart): boolean {
  if (!isRecord(part) || part.type !== ContentTypes.TOOL_CALL) {
    return false;
  }

  const partRecord = part as Record<string, unknown>;
  const toolCall = getToolCall(partRecord);
  if (!toolCall) {
    return false;
  }

  const auth = typeof toolCall.auth === 'string' ? toolCall.auth : partRecord.auth;
  if (typeof auth === 'string' && auth.trim().length > 0) {
    return true;
  }

  const name = toolCall.name;
  return typeof name === 'string' && name.startsWith(OAUTH_TOOL_CALL_PREFIX);
}

function isPersistableAbortContentPart(
  part: AbortContentPart,
): part is PersistableAbortContentPart {
  if (!isRecord(part)) {
    return false;
  }

  if (isOAuthPromptContentPart(part)) {
    return false;
  }

  if (part.type === ContentTypes.TEXT) {
    return getTextValue(part.text).trim().length > 0;
  }

  if (part.type === ContentTypes.THINK) {
    return getTextValue(part.think).trim().length > 0;
  }

  return Object.keys(part).length > 0;
}

/**
 * Whether a stopped run produced nothing at all: no part the abort filter keeps AND no
 * OAuth prompt. The distinction matters for what the abort final ships and what gets
 * saved. An OAuth-only abort is the coalesced-connection replay contract — the created
 * turn keeps its response id (see collectedUsage.spec «post-created OAuth-only aborts»);
 * a run stopped before its first token has no such claim, and an answer that never began
 * must not exist: no row, no message in the final, no empty turn on screen.
 */
export function hasNoAbortContent(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return true;
  }
  return (
    !content.some(isOAuthPromptContentPart) && filterPersistableAbortContent(content).length === 0
  );
}

export function hasPersistableAbortContent(content: unknown): boolean {
  return filterPersistableAbortContent(content).length > 0;
}

export function filterPersistableAbortContent(content: unknown): PersistableAbortContentPart[] {
  return Array.isArray(content) ? content.filter(isPersistableAbortContentPart) : [];
}
