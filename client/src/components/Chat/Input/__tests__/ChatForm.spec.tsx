/**
 * The composer's dress code, owner's decision of 11.08 (SCREEN2_REWORK plan):
 * the shell wears exactly what the sign-in card wears — hairline border on the
 * card fill under the sm shadow token — and its look NEVER answers focus or
 * typing; only the send button's icon does. This spec exists because the
 * previous composer flipped its border to ink the moment the textarea
 * autofocused on /c/new, which is precisely what the owner rejected. It
 * asserts on the resolved class string before and after focus, so re-adding
 * any focus-conditional class to the shell turns it red.
 */
import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAutoSave: () => undefined,
  useRequiresKey: () => ({ requiresKey: false }),
  useHandleKeyUp: () => jest.fn(),
  useQueryParams: () => undefined,
  useSubmitMessage: () => ({ submitMessage: jest.fn(), submitPrompt: jest.fn() }),
  useFocusChatEffect: () => undefined,
  useTextarea: () => ({
    isNotAppendable: false,
    handlePaste: jest.fn(),
    handleKeyDown: jest.fn(),
    handleCompositionStart: jest.fn(),
    handleCompositionEnd: jest.fn(),
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: undefined }),
  useGetEndpointsQuery: () => ({ data: undefined }),
}));

jest.mock('~/Providers', () => {
  const { useForm: useRealForm } = jest.requireActual('react-hook-form');
  return {
    /** A real react-hook-form instance: register/setValue/control must behave,
     *  or the focus/typing part of the contract would run against stubs. */
    useChatFormContext: () => useRealForm({ defaultValues: { text: '' } }),
    useChatContext: () => ({
      files: new Map(),
      setFiles: jest.fn(),
      conversation: { conversationId: 'new', endpoint: 'openAI', messages: [] },
      isSubmitting: false,
      filesLoading: false,
      setFilesLoading: jest.fn(),
      newConversation: jest.fn(),
      handleStopGenerating: jest.fn(),
    }),
    useAddedChatContext: () => ({
      generateConversation: jest.fn(),
      conversation: null,
      setConversation: jest.fn(),
    }),
    useAssistantsMapContext: () => ({}),
  };
});

/* The shell's look is the subject; the row of controls inside it is not. */
jest.mock('../Files/AttachFileChat', () => () => null);
jest.mock('../Files/FileFormChat', () => () => null);
jest.mock('../TextareaHeader', () => () => null);
jest.mock('../PromptsCommand', () => () => null);
jest.mock('../SkillsCommand', () => () => null);
jest.mock('../PendingManualSkillsChips', () => () => null);
jest.mock('../AudioRecorder', () => () => null);
jest.mock('../StreamAudio', () => () => null);
jest.mock('../TokenUsage', () => () => null);
jest.mock('../StopButton', () => () => null);
jest.mock('../SendButton', () => () => null);
jest.mock('../EditBadges', () => () => null);
jest.mock('../BadgeRow', () => () => null);
jest.mock('../Mention', () => () => null);

import ChatForm from '../ChatForm';

const renderComposer = () =>
  render(
    <RecoilRoot>
      <ChatForm index={0} />
    </RecoilRoot>,
  );

describe('the composer shell', () => {
  it('wears the sign-in card look: hairline border, card fill, sm shadow', () => {
    renderComposer();
    const c = screen.getByTestId('composer-shell').className.split(/\s+/);

    expect(c).toContain('border-border-light');
    expect(c).toContain('bg-surface-chat');
    expect(c).toContain('shadow-sm');
    expect(c).toContain('rounded-3xl');
    /* The rejected look: control-grey at rest flipping to ink on focus. */
    expect(c).not.toContain('border-border-control');
    expect(c).not.toContain('border-border-focus');
    expect(c.join(' ')).not.toMatch(/\bring-/);
  });

  it('opts the composer out of browser autofill (r24 + r25: contact popover on chat switch)', () => {
    /* Chrome ignores autocomplete="off" for contact autofill by policy — the
     * textarea must carry the one honored token, "new-password", plus the
     * password-manager opt-outs; the form keeps "off" for everything else. */
    renderComposer();
    const textarea = screen.getByTestId('text-input');
    expect(textarea).toHaveAttribute('autocomplete', 'new-password');
    expect(textarea).toHaveAttribute('data-1p-ignore', 'true');
    expect(textarea).toHaveAttribute('data-lpignore', 'true');
    expect(textarea.closest('form')).toHaveAttribute('autocomplete', 'off');
  });

  it('does not change a single class when the textarea gains focus or text', () => {
    renderComposer();
    const shell = screen.getByTestId('composer-shell');
    const textarea = screen.getByTestId('text-input');
    const atRest = shell.className;

    fireEvent.focus(textarea);
    expect(shell.className).toBe(atRest);

    fireEvent.change(textarea, { target: { value: 'Добрый день' } });
    expect(shell.className).toBe(atRest);

    fireEvent.blur(textarea);
    expect(shell.className).toBe(atRest);
  });

  it('sets the book’s type on the textarea: 16px, 1.6 leading, t3 placeholder', () => {
    renderComposer();
    const c = screen.getByTestId('text-input').className.split(/\s+/);

    expect(c).toContain('text-base');
    expect(c).toContain('leading-[1.6]');
    expect(c).toContain('placeholder:text-text-tertiary');
  });
});
