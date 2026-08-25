import React from 'react';
import { dataService } from 'librechat-data-provider';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDeleteFilesMutation } from '../mutations';

const showToast = jest.fn();

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: { deleteFiles: jest.fn() },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

const body = { files: [{ file_id: 'f1', filepath: '/uploads/f1' }] } as never;

describe('deleting a file that the server could not fully remove', () => {
  beforeEach(() => jest.clearAllMocks());

  /* The server keeps the record of a file whose vector cleanup failed, so that its text cannot
   * stay searchable with nothing left to link it to an owner. Before this, any such failure was
   * reported as a success: the file vanished from the list and came back on the next refresh
   * with nothing said. */
  it('tells the user the file was kept instead of staying silent', async () => {
    (dataService.deleteFiles as jest.Mock).mockRejectedValue({
      response: { status: 500 },
    });

    const { result } = renderHook(() => useDeleteFilesMutation(), { wrapper });
    result.current.mutate(body);

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_delete_incomplete', status: 'error' }),
    );
  });

  it('keeps the file in the list rather than removing it optimistically', async () => {
    (dataService.deleteFiles as jest.Mock).mockRejectedValue({ response: { status: 500 } });

    const { result } = renderHook(() => useDeleteFilesMutation(), { wrapper });
    result.current.mutate(body);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_delete_success' }),
    );
  });

  /* A refusal is a different answer and already has its own text; and an internal delete asked
   * to stay quiet must remain quiet. */
  it('leaves a refusal with its own message', async () => {
    (dataService.deleteFiles as jest.Mock).mockRejectedValue({ response: { status: 403 } });

    const { result } = renderHook(() => useDeleteFilesMutation(), { wrapper });
    result.current.mutate(body);

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_delete_not_allowed' }),
    );
  });

  it('stays quiet for a silent delete', async () => {
    (dataService.deleteFiles as jest.Mock).mockRejectedValue({ response: { status: 500 } });

    const { result } = renderHook(() => useDeleteFilesMutation({ silent: true }), { wrapper });
    result.current.mutate(body);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).not.toHaveBeenCalled();
  });
});
