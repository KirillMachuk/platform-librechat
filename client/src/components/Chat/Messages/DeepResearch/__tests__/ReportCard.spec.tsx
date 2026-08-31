/* eslint-disable i18next/no-literal-string -- placeholder children/labels in a unit test */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import ReportCard from '../ReportCard';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/components/icons', () => ({
  FileText: () => <svg data-testid="file-icon" />,
  Maximize2: () => <svg data-testid="max-icon" />,
}));
jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="reader">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe('ReportCard', () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  beforeAll(() => {
    Object.assign(navigator, { clipboard: { writeText } });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('renders the title and the preview children (collapsed)', () => {
    const { getByText, queryByTestId } = render(
      <ReportCard title="Рынок CRM" text="# Рынок CRM\nтекст">
        <div>ТЕЛО-ОТЧЁТА</div>
      </ReportCard>,
    );
    expect(getByText('Рынок CRM')).toBeInTheDocument();
    expect(getByText('ТЕЛО-ОТЧЁТА')).toBeInTheDocument();
    // reader dialog is closed until expanded
    expect(queryByTestId('reader')).toBeNull();
  });

  it('copies the raw markdown text, not the rendered children', () => {
    const { getAllByText } = render(
      <ReportCard title="T" text="RAW-MD">
        <div>rendered</div>
      </ReportCard>,
    );
    fireEvent.click(getAllByText('com_ui_copy')[0]);
    expect(writeText).toHaveBeenCalledWith('RAW-MD');
  });

  it('wears the shared card frame, not a shape of its own (owner r27)', () => {
    /* The report was the last DR surface still on the pre-К2 frame — its own
     * radius, its own header, its own buttons — sitting directly under a plan
     * card in the new one. It is the same object now: the frame's card class,
     * the frame's head with the report icon, the frame's buttons. Asserting the
     * CLASSES (identity-obj-proxy gives the raw module keys) is what makes a
     * silent drift back to bespoke markup red. */
    const { getByTestId, container } = render(
      <ReportCard title="Рынок CRM" text="md">
        <div>тело</div>
      </ReportCard>,
    );
    const card = getByTestId('report-card');
    expect(card.className).toContain('card');
    expect(card).toHaveAttribute('data-variant', 'report');
    expect(card.querySelector('.head .icon')).toHaveAttribute('data-variant', 'report');
    expect(card.querySelector('.title')?.textContent).toBe('Рынок CRM');
    expect(container.querySelector('.btnGhost')?.textContent).toBe('com_ui_copy');
    expect(container.querySelector('.btnPrimary')?.textContent).toBe('com_ui_expand');
    /* The header's icon-only control says what it does. */
    const tip = container.querySelector('.headActionTip');
    expect(tip).toHaveAttribute('data-tip', 'com_ui_expand');
  });

  it('expands into the full-screen reader on Развернуть', () => {
    const { getByText, queryByTestId } = render(
      <ReportCard title="T" text="md">
        <div>body</div>
      </ReportCard>,
    );
    act(() => {
      fireEvent.click(getByText('com_ui_expand'));
    });
    expect(queryByTestId('reader')).not.toBeNull();
  });
});
