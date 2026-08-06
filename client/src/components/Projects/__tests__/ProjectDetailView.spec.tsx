import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ProjectDetailView from '../ProjectDetailView';

/**
 * Removing a source is destructive and irreversible, so it must ask in an in-app
 * dialog rather than window.confirm. Each row owns its own dialog, so the test
 * also pins that confirming one row deletes THAT row's file — the failure mode a
 * single shared dialog would introduce.
 */

const mockDeleteFileMutate = jest.fn();

/**
 * Every unlisted data hook resolves to an inert query. Without this, adding any
 * new hook to a child component breaks this spec for reasons unrelated to it.
 */
jest.mock('~/data-provider', () => {
  const explicit: Record<string, unknown> = {
    useGetProjectQuery: () => ({
      data: { projectId: 'p1', name: 'Аренда ТЦ', description: '', instructions: '' },
      isLoading: false,
    }),
    useProjectFilesQuery: () => ({
      data: [
        { file_id: 'f1', filename: 'Договор.pdf', bytes: 2400 },
        { file_id: 'f2', filename: 'Эталон.docx', bytes: 1800 },
      ],
      isLoading: false,
    }),
    useDeleteProjectFileMutation: () => ({ mutate: mockDeleteFileMutate, isLoading: false }),
  };
  const inert = () => ({ data: undefined, isLoading: false, mutate: jest.fn() });
  return new Proxy(explicit, {
    get: (target, prop: string) => (prop in target ? target[prop] : inert),
  });
});

jest.mock('librechat-data-provider/react-query', () => ({
  ...jest.requireActual('librechat-data-provider/react-query'),
  useGetModelsQuery: () => ({ data: {} }),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));

function renderView() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RecoilRoot>
        <MemoryRouter>{children}</MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>
  );
  return render(<ProjectDetailView projectId="p1" onBack={jest.fn()} onClose={jest.fn()} />, {
    wrapper,
  });
}

describe('ProjectDetailView — removing a source', () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDeleteFileMutate.mockClear();
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('confirms in a dialog naming the file, never through window.confirm', async () => {
    const user = userEvent.setup();
    renderView();

    // The view opens on the chats tab; sources live behind their own tab.
    /* The two sections are a canon §6.5 segment now, so they answer to `tab`
       rather than `button` — and a tab is what a screen reader should hear. */
    await user.click(await screen.findByRole('tab', { name: /Sources/ }));

    const removeButtons = await screen.findAllByRole('button', { name: 'Remove source' });
    expect(removeButtons).toHaveLength(2);

    await user.click(removeButtons[1]);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockDeleteFileMutate).not.toHaveBeenCalled();
    const confirm = within(await screen.findByRole('dialog'));
    expect(confirm.getByText(/Эталон\.docx/)).toBeInTheDocument();

    await user.click(confirm.getByRole('button', { name: 'Remove source' }));

    // The row that was clicked is the row that gets deleted.
    await waitFor(() =>
      expect(mockDeleteFileMutate).toHaveBeenCalledWith({ projectId: 'p1', fileId: 'f2' }),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
