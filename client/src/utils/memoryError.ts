import type { TranslationKeys } from '~/hooks';

/**
 * Turns a failed memory write into something the employee can read.
 *
 * The server answers refusals with a machine-readable `errorType` precisely so the
 * wording lives here: its own `error` string is English prose meant for logs, and
 * showing it raw puts an untranslated sentence in front of a Russian-speaking user.
 */
const ERROR_TYPE_KEYS: Record<string, TranslationKeys> = {
  personal_data: 'com_ui_memory_personal_data',
  guard_unavailable: 'com_ui_memory_guard_unavailable',
};

export interface MemoryErrorResponse {
  status?: number;
  data?: { error?: string; errorType?: string };
}

export function memoryErrorKey(response?: MemoryErrorResponse): TranslationKeys | undefined {
  const errorType = response?.data?.errorType;
  if (errorType && ERROR_TYPE_KEYS[errorType]) {
    return ERROR_TYPE_KEYS[errorType];
  }

  const message = response?.data?.error ?? '';
  if (response?.status === 409 || message.includes('already exists')) {
    return 'com_ui_memory_key_exists';
  }
  if (message.includes('lowercase letters and underscores')) {
    return 'com_ui_memory_key_validation';
  }
  return undefined;
}
