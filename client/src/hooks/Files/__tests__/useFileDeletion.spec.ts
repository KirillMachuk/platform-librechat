import { renderHook, act } from '@testing-library/react';
import type { ExtendedFile } from '~/common';

jest.mock('~/utils', () => ({ deletePreview: jest.fn() }));
jest.mock('../useSetFilesToDelete', () => ({ __esModule: true, default: () => jest.fn() }));

import useFileDeletion from '../useFileDeletion';

describe('useFileDeletion.deleteFile', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('removes a still-uploading file from the UI and skips the server delete', () => {
    const mutateAsync = jest.fn();
    const { result } = renderHook(() => useFileDeletion({ mutateAsync }));
    const setFiles = jest.fn();
    const file = { file_id: 'f1', temp_file_id: 't1', progress: 0.4 } as unknown as ExtendedFile;

    act(() => result.current.deleteFile({ file, setFiles }));

    // UI removal still happens mid-upload (the bug: X used to be a no-op here)
    expect(setFiles).toHaveBeenCalledTimes(1);
    const updater = setFiles.mock.calls[0][0] as (
      m: Map<string, ExtendedFile>,
    ) => Map<string, ExtendedFile>;
    const next = updater(new Map([['f1', file]]));
    expect(next.has('f1')).toBe(false);

    // No server-side delete for a file that isn't persisted yet — even past the debounce window
    act(() => jest.advanceTimersByTime(2000));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('removes a completed file and issues the server delete', () => {
    const mutateAsync = jest.fn();
    const { result } = renderHook(() => useFileDeletion({ mutateAsync }));
    const setFiles = jest.fn();
    const file = {
      file_id: 'f2',
      temp_file_id: '',
      progress: 1,
      filepath: '/p',
      source: 'local',
    } as unknown as ExtendedFile;

    act(() => result.current.deleteFile({ file, setFiles }));

    expect(setFiles).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(1100));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
