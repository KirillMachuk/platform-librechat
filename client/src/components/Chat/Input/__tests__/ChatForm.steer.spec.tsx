import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import store from '~/store';

/**
 * Mid-run steering in the composer (DR_MIDRUN_STEERING_Plan.md, owner decision
 * 1: «куда пишет человек — обычный композер»). While a research run gathers,
 * the slot that normally turns into Stop stays Send and hands the run a
 * clarification; Stop lives on the card. Once the report is being written
 * the composer says so and sends nothing.
 */

const mockSteerRun = jest.fn();
const mockSubmitMessage = jest.fn();
const mockAudioRecorder = jest.fn();
const mockUseTextarea = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAutoSave: () => undefined,
  useRequiresKey: () => ({ requiresKey: false }),
  useHandleKeyUp: () => jest.fn(),
  useQueryParams: () => undefined,
  useSubmitMessage: () => ({ submitMessage: mockSubmitMessage, submitPrompt: jest.fn() }),
  useFocusChatEffect: () => undefined,
  useSteerRun: () => mockSteerRun(),
  useTextarea: (args: unknown) => {
    mockUseTextarea(args);
    return {
      isNotAppendable: false,
      handlePaste: jest.fn(),
      handleKeyDown: jest.fn(),
      handleCompositionStart: jest.fn(),
      handleCompositionEnd: jest.fn(),
    };
  },
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: undefined }),
  useGetEndpointsQuery: () => ({ data: undefined }),
}));

jest.mock('~/Providers', () => {
  const { useForm: useRealForm } = jest.requireActual('react-hook-form');
  return {
    useChatFormContext: () => useRealForm({ defaultValues: { text: '' } }),
    useChatContext: () => ({
      files: new Map(),
      setFiles: jest.fn(),
      conversation: { conversationId: 'c1', endpoint: 'openAI', messages: [] },
      isSubmitting: true,
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

jest.mock('../Files/AttachFileChat', () => () => null);
jest.mock('../Files/FileFormChat', () => () => null);
jest.mock('../TextareaHeader', () => () => null);
jest.mock('../PromptsCommand', () => () => null);
jest.mock('../SkillsCommand', () => () => null);
jest.mock('../PendingManualSkillsChips', () => () => null);
jest.mock('../AudioRecorder', () => (props: unknown) => {
  mockAudioRecorder(props);
  return null;
});
jest.mock('../StreamAudio', () => () => null);
jest.mock('../TokenUsage', () => () => null);
jest.mock('../StopButton', () => () => <button type="button" data-testid="stop" />);
jest.mock('../SendButton', () => {
  const { forwardRef } = jest.requireActual('react') as typeof import('react');
  const Send = forwardRef<HTMLButtonElement, { disabled?: boolean }>(function Send(
    { disabled },
    ref,
  ) {
    return <button type="submit" data-testid="send" disabled={disabled} ref={ref} />;
  });
  return Send;
});
jest.mock('../EditBadges', () => () => null);
jest.mock('../BadgeRow', () => () => null);
jest.mock('../Mention', () => () => null);

import ChatForm from '../ChatForm';

const renderComposer = () =>
  render(
    <RecoilRoot initializeState={({ set }) => set(store.showStopButtonByIndex(0), true)}>
      <ChatForm index={0} />
    </RecoilRoot>,
  );

const steerState = (over: Partial<ReturnType<typeof mockSteerRun>> = {}) => ({
  canSteer: false,
  steerClosed: false,
  steerPending: false,
  steer: jest.fn(),
  ...over,
});

describe('the composer while a research run is under way', () => {
  beforeEach(() => {
    mockSteerRun.mockReset();
    mockUseTextarea.mockReset();
    mockAudioRecorder.mockReset();
    mockSubmitMessage.mockReset();
  });

  it('shows Stop, as before, when the run cannot be steered (pre-graph phases, ordinary chats)', () => {
    mockSteerRun.mockReturnValue(steerState());
    renderComposer();
    expect(screen.getByTestId('stop')).toBeInTheDocument();
    expect(screen.queryByTestId('send')).toBeNull();
    expect(mockUseTextarea.mock.calls[0][0]).toMatchObject({ canSteer: false });
  });

  it('keeps Send live while the run gathers: the slot is a channel to the run, Stop is on the card', () => {
    mockSteerRun.mockReturnValue(steerState({ canSteer: true }));
    renderComposer();
    expect(screen.queryByTestId('stop')).toBeNull();
    expect(screen.getByTestId('send')).toBeEnabled();
    expect(mockUseTextarea.mock.calls[0][0]).toMatchObject({
      canSteer: true,
      placeholder: 'com_ui_dr_steer_placeholder',
    });
  });

  it('while a clarification is in flight Send waits (no double steer)', () => {
    mockSteerRun.mockReturnValue(steerState({ canSteer: true, steerPending: true }));
    renderComposer();
    expect(screen.getByTestId('send')).toBeDisabled();
  });

  it('once the report is being written: Send stays but is disabled, and the placeholder says why', () => {
    mockSteerRun.mockReturnValue(steerState({ steerClosed: true }));
    renderComposer();
    expect(screen.queryByTestId('stop')).toBeNull();
    expect(screen.getByTestId('send')).toBeDisabled();
    expect(mockUseTextarea.mock.calls[0][0]).toMatchObject({
      canSteer: false,
      placeholder: 'com_ui_dr_steer_closed_placeholder',
    });
  });

  const renderWithSpeech = () =>
    render(
      <RecoilRoot
        initializeState={({ set }) => {
          set(store.showStopButtonByIndex(0), true);
          /* The recorder renders only when speech-to-text is on. */
          set(store.speechToText, true);
        }}
      >
        <ChatForm index={0} />
      </RecoilRoot>,
    );

  it('dictation follows the composer: in steer mode it goes to the run and the «wait» guard stands down', () => {
    const steer = jest.fn().mockResolvedValue(true);
    mockSteerRun.mockReturnValue(steerState({ canSteer: true, steer }));
    renderWithSpeech();
    const props = mockAudioRecorder.mock.calls[0][0] as {
      ask: (data: { text: string }) => false | void;
      isSubmitting: boolean;
    };
    expect(props.isSubmitting).toBe(false);
    /* `false` keeps the dictated text in the field until the run has taken it. */
    expect(props.ask({ text: 'голосом' })).toBe(false);
    expect(steer).toHaveBeenCalledWith('голосом');
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  it('dictation outside steer mode is the ordinary submit behind the ordinary guard', () => {
    mockSteerRun.mockReturnValue(steerState());
    renderWithSpeech();
    const props = mockAudioRecorder.mock.calls[0][0] as { ask: unknown; isSubmitting: boolean };
    expect(props.isSubmitting).toBe(true);
    expect(props.ask).toBe(mockSubmitMessage);
  });
});
