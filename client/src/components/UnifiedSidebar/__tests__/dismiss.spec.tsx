import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PanelDismissProvider, usePanelDismiss } from '../dismiss';

function DismissButton() {
  const dismiss = usePanelDismiss();
  return <button data-testid="dismiss" onClick={dismiss} aria-label="dismiss" />;
}

describe('usePanelDismiss', () => {
  it('calls the provider handler when rendered inside a panel', () => {
    const onDismiss = jest.fn();
    render(
      <PanelDismissProvider onDismiss={onDismiss}>
        <DismissButton />
      </PanelDismissProvider>,
    );

    fireEvent.click(screen.getByTestId('dismiss'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op outside a panel, so the same components work as full pages', () => {
    render(<DismissButton />);

    expect(() => fireEvent.click(screen.getByTestId('dismiss'))).not.toThrow();
  });
});
