import type { TFile } from './types/files';
import type { TMessage } from './types';

export type ParentMessage = TMessage & { children: TMessage[]; depth: number };
export function buildTree({
  messages,
  fileMap,
}: {
  messages: (TMessage | undefined)[] | null;
  fileMap?: Record<string, TFile>;
}) {
  if (messages === null) {
    return null;
  }

  const messageMap: Record<string, ParentMessage> = {};
  const rootMessages: TMessage[] = [];
  const childrenCount: Record<string, number> = {};

  messages.forEach((message) => {
    if (!message) {
      return;
    }
    const parentId = message.parentMessageId ?? '';

    /**
     * One message, one node — even when the array carries it twice. A repeated id is
     * always a caller's bug, but the tree is where it turns into a lie the user acts on:
     * both copies land in the parent's `children`, so the thread grows a sibling switcher
     * for a branch nobody made, and only one half of it keeps the rest of the
     * conversation (measured on the owner's Deep Research chat, 01.09.2026 — «2 / 2» on
     * a linear thread, its first half an empty dead end). Later fields win, so a fresher
     * copy still replaces a stale one; `children` stay on the node that already collected
     * them.
     */
    const seen = messageMap[message.messageId];
    if (seen) {
      const files =
        message.files && fileMap
          ? message.files.map((file) => fileMap[file.file_id ?? ''] ?? file)
          : message.files;
      Object.assign(seen, message, {
        files: files ?? seen.files,
        children: seen.children,
        depth: seen.depth,
        siblingIndex: seen.siblingIndex,
      });
      return;
    }

    childrenCount[parentId] = (childrenCount[parentId] || 0) + 1;

    const extendedMessage: ParentMessage = {
      ...message,
      children: [],
      depth: 0,
      siblingIndex: childrenCount[parentId] - 1,
    };

    if (message.files && fileMap) {
      extendedMessage.files = message.files.map((file) => fileMap[file.file_id ?? ''] ?? file);
    }

    messageMap[message.messageId] = extendedMessage;

    const parentMessage = messageMap[parentId];
    if (parentMessage) {
      parentMessage.children.push(extendedMessage);
      extendedMessage.depth = parentMessage.depth + 1;
    } else {
      rootMessages.push(extendedMessage);
    }
  });

  return rootMessages;
}
