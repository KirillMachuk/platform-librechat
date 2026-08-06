import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TProject } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import ProjectEditDialog from '../ProjectEditDialog';

/**
 * Destructive actions must go through an in-app dialog, never window.confirm:
 * the native prompt ignores the app's theme and its buttons are labelled by the
 * BROWSER's locale, so a Russian-speaking user on an English browser is asked to
 * confirm a deletion with "OK"/"Cancel". The dialog is rendered for real here
 * (only the data layer is mocked) so a regression to window.confirm — or to a
 * generic "OK" button — actually fails.
 */

const mockDeleteMutate = jest.fn();
const mockUpdateMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useDeleteProjectMutation: () => ({ mutate: mockDeleteMutate, isLoading: false }),
  useUpdateProjectMutation: () => ({ mutate: mockUpdateMutate, isLoading: false }),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => jest.fn(),
}));

const project: TProject = {
  projectId: 'p1',
  name: 'Аренда ТЦ',
  description: '',
  instructions: '',
} as TProject;

function renderDialog() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RecoilRoot>
        <MemoryRouter>{children}</MemoryRouter>
      </RecoilRoot>
    </QueryClientProvider>
  );
  return render(<ProjectEditDialog project={project} open onOpenChange={jest.fn()} />, { wrapper });
}

describe('ProjectEditDialog — form labels', () => {
  it('every label points at its own field', () => {
    renderDialog();

    // The dialog body once shared the id `project-edit-description` with the
    // description input. A <label for> resolves to the FIRST element with that id,
    // so the label pointed at the body div — clicking it focused nothing and a
    // screen reader announced the whole form as the field's name.
    // Two of the three carry canon §6.4's "(optional)" inside the label, so the
    // accessible name is "Description (optional)" — matched loosely on purpose,
    // while still asserting that what the label points at is the control.
    for (const name of [/^Name$/, /^Description/, /^Project instructions/]) {
      const field = screen.getByLabelText(name);
      expect(field.tagName).toMatch(/INPUT|TEXTAREA/);
    }
  });

  it('uses each id exactly once', () => {
    renderDialog();
    // Search the document, not the render container: dialog content is portaled
    // out of it, so scoping to the container would find nothing and pass blindly.
    const ids = [...document.body.querySelectorAll('[id^="project-edit"]')].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ProjectEditDialog — deleting a project', () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    mockDeleteMutate.mockClear();
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('asks in an in-app dialog and never through window.confirm', async () => {
    const user = userEvent.setup();
    renderDialog();

    const trigger = screen.getByRole('button', { name: 'Delete project' });
    await user.click(trigger);

    expect(confirmSpy).not.toHaveBeenCalled();
    // The trigger alone must not delete anything.
    expect(mockDeleteMutate).not.toHaveBeenCalled();

    // The confirmation names the project and offers a verb, not "OK".
    expect(await screen.findByText(/Delete project "Аренда ТЦ"/)).toBeInTheDocument();
    // While the confirmation is open Radix hides everything under it from the
    // accessibility tree, so the only reachable "Delete project" button is the
    // confirm itself — and there is no generic OK anywhere.
    expect(screen.queryByRole('button', { name: /^ok$/i })).not.toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Delete project' });

    await user.click(confirmButton);
    await waitFor(() => expect(mockDeleteMutate).toHaveBeenCalledWith('p1'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('cancelling leaves the project alone', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await screen.findByText(/Delete project "Аренда ТЦ"/);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText(/Delete project "Аренда ТЦ"/)).not.toBeInTheDocument(),
    );
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });
});
