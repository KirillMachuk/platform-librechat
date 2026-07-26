import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import type { MutableSnapshot } from 'recoil';
import type { TConversation } from 'librechat-data-provider';
import AddMultiConvo from '../AddMultiConvo';
import store from '~/store';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    TooltipAnchor: ({
      children,
      onClick,
      ...props
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => R.createElement('button', { onClick, ...props }, children),
  };
});

const PopoverProbe = () => {
  const show = useRecoilValue(store.showPlusPopoverFamily(0));
  const fromButton = useRecoilValue(store.plusPopoverFromButtonFamily(0));
  return (
    <>
      <span data-testid="popover-state">{String(show)}</span>
      <span data-testid="popover-from-button">{String(fromButton)}</span>
    </>
  );
};

const AddedConvoProbe = () => {
  const addedConvo = useRecoilValue(store.conversationByIndex(1));
  return <span data-testid="added-convo">{addedConvo == null ? 'none' : 'present'}</span>;
};

const renderWithEndpoint = (endpoint: string | null) => {
  const initializeState = ({ set }: MutableSnapshot) => {
    set(store.conversationByIndex(0), { conversationId: 'convo-1', endpoint } as TConversation);
  };

  return render(
    <RecoilRoot initializeState={initializeState}>
      <AddMultiConvo />
      <PopoverProbe />
      <AddedConvoProbe />
    </RecoilRoot>,
  );
};

describe('AddMultiConvo', () => {
  it('opens the model picker instead of silently cloning the current model', async () => {
    renderWithEndpoint('1ma');

    expect(screen.getByTestId('popover-state')).toHaveTextContent('false');

    await userEvent.click(screen.getByTestId('add-multi-convo-button'));

    expect(screen.getByTestId('popover-state')).toHaveTextContent('true');
    expect(screen.getByTestId('added-convo')).toHaveTextContent('none');
    /** Marks the picker as button-opened so it leaves the composer draft alone. */
    expect(screen.getByTestId('popover-from-button')).toHaveTextContent('true');
  });

  it('renders nothing without an endpoint', () => {
    renderWithEndpoint(null);

    expect(screen.queryByTestId('add-multi-convo-button')).not.toBeInTheDocument();
  });

  it('renders nothing on the assistants endpoint', () => {
    renderWithEndpoint('assistants');

    expect(screen.queryByTestId('add-multi-convo-button')).not.toBeInTheDocument();
  });
});
