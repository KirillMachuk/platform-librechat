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

  /**
   * The «report is incomplete» note has to reach BOTH surfaces.
   *
   * Measured at 375×812 before this prop existed (`tools/dr_report_card_probe.js`):
   * `noticeInsideDialog: false` — the reader, where the whole report is actually read,
   * was the one surface that never said the report had been cut short.
   */
  it('carries the note inside the collapsed card', () => {
    const { getByTestId } = render(
      <ReportCard title="T" text="md" notice={<div data-testid="note">неполный</div>}>
        <div>body</div>
      </ReportCard>,
    );
    expect(getByTestId('note')).toBeInTheDocument();
  });

  it('carries the note inside the reader too', () => {
    const { getByText, getByTestId, getAllByTestId } = render(
      <ReportCard title="T" text="md" notice={<div data-testid="note">неполный</div>}>
        <div>body</div>
      </ReportCard>,
    );
    act(() => {
      fireEvent.click(getByText('com_ui_expand'));
    });
    const reader = getByTestId('reader');
    // FAILS ON PRE-FIX CODE: the reader is a portal and the note used to live outside it.
    expect(getAllByTestId('note').some((el) => reader.contains(el))).toBe(true);
  });

  it('says nothing extra when the report is complete', () => {
    const { queryByTestId } = render(
      <ReportCard title="T" text="md">
        <div>body</div>
      </ReportCard>,
    );
    expect(queryByTestId('note')).toBeNull();
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
