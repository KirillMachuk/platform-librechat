import { useMutation } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';
import type { TUserPreferences } from 'librechat-data-provider';

/**
 * Merges personal interface settings into the account. The reply carries the full merged
 * set, which the caller uses as its new baseline for deciding what still needs sending.
 */
export const useUpdateUserPreferencesMutation = () =>
  useMutation((preferences: TUserPreferences) => dataService.updateUserPreferences(preferences));
