import { useRef } from 'react';
import { useToastContext } from '@librechat/client';
import { useLocalize } from '~/hooks';

export const useDelayedUploadToast = () => {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  /* A ref, not state: nothing renders from this map, and an upload that finishes
   * before React re-renders must still be able to cancel its own notice. Held in
   * state, `clearUploadTimer` read whatever the last render captured — usually a
   * map without this upload in it — so the notice fired over an upload that had
   * already succeeded, taking the single toast slot from whatever the app said
   * next. */
  const uploadTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const determineDelay = (fileSize: number): number => {
    const baseDelay = 5000;
    const additionalDelay = Math.floor(fileSize / 1000000) * 2000;
    return baseDelay + additionalDelay;
  };

  const startUploadTimer = (fileId: string, fileName: string, fileSize: number) => {
    const delay = determineDelay(fileSize);
    clearTimeout(uploadTimers.current[fileId]);

    uploadTimers.current[fileId] = setTimeout(() => {
      delete uploadTimers.current[fileId];
      showToast({
        message: localize('com_ui_upload_delay', { 0: fileName }),
        status: 'warning',
        duration: 10000,
      });
    }, delay);
  };

  const clearUploadTimer = (fileId: string) => {
    clearTimeout(uploadTimers.current[fileId]);
    delete uploadTimers.current[fileId];
  };

  return { startUploadTimer, clearUploadTimer };
};
