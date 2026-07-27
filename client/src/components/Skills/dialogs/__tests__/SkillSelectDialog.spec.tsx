import { useForm, FormProvider } from 'react-hook-form';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { UseFormReturn } from 'react-hook-form';
import type { ReactNode } from 'react';
import type { AgentForm } from '~/common';
import { PanelDismissProvider } from '~/components/UnifiedSidebar/dismiss';
import SkillSelectDialog from '../SkillSelectDialog';

const mockNavigate = jest.fn();
const mockSetIsOpen = jest.fn();
const mockDismiss = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock(
  '@librechat/client',
  () => {
    const React = jest.requireActual<typeof import('react')>('react');
    return {
      OGDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
        open ? React.createElement('div', null, children) : null,
      OGDialogContent: ({ children }: { children: ReactNode }) =>
        React.createElement('div', null, children),
    };
  },
  { virtual: true },
);

jest.mock('~/data-provider', () => ({
  useListSkillsQuery: () => ({ data: { skills: [] } }),
}));

jest.mock('~/components/Prompts', () => ({
  CategoryIcon: () => null,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ user: { id: 'user-1' } }),
  useCategories: () => ({ categories: [] }),
  useHasAccess: () => true,
  useSkillFavorites: () => ({ isFavorite: () => false, toggle: jest.fn() }),
}));

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

let formMethods: UseFormReturn<AgentForm>;

function Harness() {
  const methods = useForm<AgentForm>({ defaultValues: { name: '', skills: [] } });
  formMethods = methods;
  return (
    <PanelDismissProvider onDismiss={mockDismiss}>
      <FormProvider {...methods}>
        <SkillSelectDialog isOpen={true} setIsOpen={mockSetIsOpen} />
      </FormProvider>
    </PanelDismissProvider>
  );
}

const clickCreate = () =>
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_create_skill' }));

describe('SkillSelectDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dismisses the surrounding panel before routing to the skill editor', () => {
    render(<Harness />);

    clickCreate();

    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/skills/new');
  });

  it('keeps the user in the builder when a dirty agent form is not confirmed', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Harness />);

    act(() => {
      formMethods.setValue('name', 'unsaved agent', { shouldDirty: true });
    });
    clickCreate();

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('leaves a dirty agent form once the warning is confirmed', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Harness />);

    act(() => {
      formMethods.setValue('name', 'unsaved agent', { shouldDirty: true });
    });
    clickCreate();

    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/skills/new');
  });
});
