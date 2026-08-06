import { renderHook, act } from '@testing-library/react';

const mockShowToast = jest.fn();

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

import { useDelayedUploadToast } from '../useDelayedUploadToast';

/**
 * The "this upload is taking a while" notice must never outlive the upload. It
 * shares the single toast slot with everything else, so a stale one does not
 * merely add noise — it replaces whatever the app said afterwards, and the
 * message it buried was the one worth reading ("this model cannot read
 * images").
 */
describe('useDelayedUploadToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockShowToast.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('warns when an upload outlives the delay', () => {
    const { result } = renderHook(() => useDelayedUploadToast());

    act(() => result.current.startUploadTimer('f1', 'photo.png', 1_000_000));
    act(() => void jest.advanceTimersByTime(60_000));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  /**
   * The timers used to live in `useState`, so `clearUploadTimer` read whatever
   * the last render captured. An upload that finished before React re-rendered
   * cleared nothing, and the notice fired afterwards over a finished upload.
   */
  it('cancels the notice for an upload that finishes within the same render', () => {
    const { result } = renderHook(() => useDelayedUploadToast());

    act(() => {
      result.current.startUploadTimer('f1', 'photo.png', 1_000_000);
      result.current.clearUploadTimer('f1');
    });
    act(() => void jest.advanceTimersByTime(60_000));

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('cancels only the upload it was asked to cancel', () => {
    const { result } = renderHook(() => useDelayedUploadToast());

    act(() => {
      result.current.startUploadTimer('f1', 'one.png', 1_000_000);
      result.current.startUploadTimer('f2', 'two.png', 1_000_000);
      result.current.clearUploadTimer('f1');
    });
    act(() => void jest.advanceTimersByTime(60_000));

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
