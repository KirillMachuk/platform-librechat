/**
 * The owner's 11.08 complaint, verbatim: «иконки под сообщением юзера куда-то
 * пропадают в некоторых чатах, а иногда появляются». Measured live: while ANY
 * generation ran in a chat, Copy under every user message sat at opacity 0
 * (hover-only) and Edit at opacity 0 + disabled — for a Deep Research run that
 * is minutes of «the icons are gone», and a rare stale-render froze them
 * hidden until the chat was reopened.
 *
 * The contract this spec locks: an action under a user message is NEVER
 * invisible for a temporary reason. Copy works at any moment; Edit stays
 * visible and is merely disabled (dimmed by the canon's 45) while a stream
 * runs; only a structural impossibility (e.g. a search result) may hide it.
 */
import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { TConversation, TMessage } from 'librechat-data-provider';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useGenerationsByLatest: jest.requireActual('~/hooks/useGenerationsByLatest').default,
}));

jest.mock('../MessageAudio', () => () => null);
jest.mock('../Feedback', () => () => null);
jest.mock('~/components/Conversations', () => ({ Fork: () => null }));

import HoverButtons from '../HoverButtons';

const conversation = { conversationId: 'c1', endpoint: 'openAI' } as TConversation;

const userMessage = (overrides: Partial<TMessage> = {}) =>
  ({
    messageId: 'm-user',
    isCreatedByUser: true,
    text: 'Вопрос',
    error: false,
    ...overrides,
  }) as TMessage;

const renderButtons = (props: { isSubmitting: boolean; message: TMessage }) =>
  render(
    <RecoilRoot>
      <HoverButtons
        index={0}
        isEditing={false}
        enterEdit={jest.fn()}
        copyToClipboard={jest.fn()}
        conversation={conversation}
        isSubmitting={props.isSubmitting}
        message={props.message}
        regenerate={jest.fn()}
        handleContinue={jest.fn()}
        latestMessageId="m-latest"
        isLast={false}
      />
    </RecoilRoot>,
  );

describe('actions under a user message while a generation runs', () => {
  it('keeps Copy fully visible and clickable', () => {
    renderButtons({ isSubmitting: true, message: userMessage() });
    const copy = screen.getByTitle('com_ui_copy_to_clipboard');

    expect(copy).toBeEnabled();
    const classes = copy.className.split(/\s+/);
    expect(classes).not.toContain('opacity-0');
    expect(copy.className).not.toMatch(/hover:hover/);
  });

  it('keeps Edit visible — disabled and dimmed, not vanished', () => {
    renderButtons({ isSubmitting: true, message: userMessage() });
    const edit = screen.getByTitle('com_ui_edit');

    expect(edit).toBeDisabled();
    const classes = edit.className.split(/\s+/);
    expect(classes).not.toContain('opacity-0');
    expect(classes).toContain('disabled:opacity-45');
  });
});

describe('actions under a user message at rest', () => {
  it('enables Edit again the moment nothing is streaming', () => {
    renderButtons({ isSubmitting: false, message: userMessage() });
    expect(screen.getByTitle('com_ui_edit')).toBeEnabled();
    expect(screen.getByTitle('com_ui_copy_to_clipboard')).toBeEnabled();
  });

  it('still hides Edit for a structural reason: a search result', () => {
    renderButtons({ isSubmitting: false, message: userMessage({ searchResult: true }) });
    const edit = screen.getByTitle('com_ui_edit');
    const classes = edit.className.split(/\s+/);

    expect(classes).toContain('opacity-0');
    expect(edit).toBeDisabled();
  });
});
