import debounce from 'lodash/debounce';
import { Constants, LocalStorageKeys } from 'librechat-data-provider';

export const clearDraft = debounce((id?: string | null) => {
  localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${id ?? ''}`);
}, 2500);

/** Synchronously removes both text and file drafts for a conversation (or NEW_CONVO fallback) */
export const clearAllDrafts = (conversationId?: string | null) => {
  const key = conversationId || Constants.NEW_CONVO;
  localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${key}`);
  localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${key}`);
};

export const encodeBase64 = (plainText: string): string => {
  try {
    const textBytes = new TextEncoder().encode(plainText);
    return btoa(String.fromCharCode(...textBytes));
  } catch {
    return '';
  }
};

export const decodeBase64 = (base64String: string): string => {
  try {
    const bytes = atob(base64String);
    const uint8Array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      uint8Array[i] = bytes.charCodeAt(i);
    }
    return new TextDecoder().decode(uint8Array);
  } catch {
    return '';
  }
};

export const setDraft = ({ id, value }: { id: string; value?: string }) => {
  if (value && value.length > 1) {
    localStorage.setItem(`${LocalStorageKeys.TEXT_DRAFT}${id}`, encodeBase64(value));
    return;
  }
  localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${id}`);
};

export const getDraft = (id?: string): string | null =>
  decodeBase64((localStorage.getItem(`${LocalStorageKeys.TEXT_DRAFT}${id ?? ''}`) ?? '') || '');

/**
 * Unsent answers of an `ask_user` questions card, keyed by the TOOL CALL id
 * (the one identity that survives both the finalization remount and a page
 * reload — the message id is provisional while the card streams in, see
 * ContentParts' askAnswers map). The phone browser reloads a background tab
 * on its own, which threw away a half-filled card (owner, r26). The entry
 * lives until the card commits — «Продолжить» or «Пропустить» — so the
 * card that comes back after a reload is the card the person left.
 */
const ASK_ANSWERS_DRAFT_KEY = 'askAnswersDraft_';

export const getAskAnswersDraft = (callId: string): Record<string, string> | undefined => {
  try {
    const raw = localStorage.getItem(`${ASK_ANSWERS_DRAFT_KEY}${callId}`);
    if (!raw) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) {
        answers[key] = value;
      }
    }
    return Object.keys(answers).length > 0 ? answers : undefined;
  } catch {
    return undefined;
  }
};

export const setAskAnswersDraft = (callId: string, answers: Record<string, string>) => {
  try {
    const key = `${ASK_ANSWERS_DRAFT_KEY}${callId}`;
    if (Object.values(answers).some((value) => value.trim())) {
      localStorage.setItem(key, JSON.stringify(answers));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* Storage is unavailable (private mode, quota): the card still works
     * for the session, it only stops surviving a reload. */
  }
};

export const clearAskAnswersDraft = (callId: string) => {
  try {
    localStorage.removeItem(`${ASK_ANSWERS_DRAFT_KEY}${callId}`);
  } catch {
    /* See setAskAnswersDraft. */
  }
};
