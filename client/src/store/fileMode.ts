import { atomFamily } from 'recoil';
import type { FileMode } from '~/utils/fileMode';

/**
 * Per-conversation file-handling mode for the next message's attachments.
 *
 * Defaults to `'auto'` (the system decides deterministically by file type and
 * size — see `resolveAutoFileMode`). The user can override it from the chat
 * toolbar (Text / Native / Search). Keyed by conversationId so each chat keeps
 * its own choice, mirroring `ephemeralAgentByConvoId`.
 */
export const fileModeByConvoId = atomFamily<FileMode, string>({
  key: 'fileModeByConvoId',
  default: 'auto',
});
