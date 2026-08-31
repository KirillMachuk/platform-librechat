import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import translationEn from '~/locales/en/translation.json';
import translationRu from '~/locales/ru/translation.json';
import BashCall from '../BashCall';

/**
 * 31.08.2026 on the stand: a run in «Авто» built a .pptx and then ran out of the steps
 * allotted to one turn, with one more `bash_tool` call already dispatched. That last call
 * never ran, and the card labelled it «✕ Отменен» — over a run nobody had cancelled.
 *
 * This side cannot tell a Stop from a run that broke: all it knows is that the stream ended
 * with the call short of `progress === 1`. So the card states the outcome, not a cause.
 * Rendered through the real `ProgressText`, because the label only reaches the screen via
 * its `error` branch — a mocked one shows the in-progress text and would pass either way.
 */
jest.mock('~/hooks', () => {
  const en = jest.requireActual('~/locales/en/translation.json') as Record<string, string>;
  return {
    useLocalize: () => (key: string) => en[key] ?? key,
    useProgress: (initialProgress: number) => initialProgress,
    useExpandCollapse: () => ({ style: {}, ref: { current: null } }),
  };
});

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

jest.mock('~/components/Messages/Content/CopyButton', () => ({
  __esModule: true,
  default: () => <button type="button" data-testid="copy-button" />,
}));
jest.mock('~/components/Messages/Content/LangIcon', () => ({
  __esModule: true,
  default: () => <span />,
}));
jest.mock('../Attachment', () => ({ AttachmentGroup: () => <div /> }));
jest.mock('../useLazyHighlight', () => ({ __esModule: true, default: () => null }));
jest.mock('copy-to-clipboard', () => jest.fn());

const renderDispatchedCall = ({ isSubmitting }: { isSubmitting: boolean }) =>
  render(
    <RecoilRoot>
      <BashCall
        initialProgress={0.1}
        isSubmitting={isSubmitting}
        args={'{"command":"ls -la /mnt/data"}'}
        output=""
      />
    </RecoilRoot>,
  );

describe('a tool call the run never got to', () => {
  it('does not claim anyone cancelled it', () => {
    renderDispatchedCall({ isSubmitting: false });

    expect(screen.queryByText(translationEn['com_ui_cancelled'])).not.toBeInTheDocument();
  });

  it('states the outcome instead: the step did not run', () => {
    renderDispatchedCall({ isSubmitting: false });

    expect(screen.getByText(translationEn['com_ui_tool_call_not_run'])).toBeInTheDocument();
  });

  it('leaves a call that is still running alone', () => {
    renderDispatchedCall({ isSubmitting: true });

    expect(screen.getByText(translationEn['com_ui_running_command'])).toBeInTheDocument();
    expect(screen.queryByText(translationEn['com_ui_tool_call_not_run'])).not.toBeInTheDocument();
  });

  it('ships the label in both en and ru (no production fallback)', () => {
    expect(translationEn['com_ui_tool_call_not_run']).toEqual(expect.any(String));
    expect(translationRu['com_ui_tool_call_not_run']).toMatch(/[а-яА-Я]/);
  });
});
