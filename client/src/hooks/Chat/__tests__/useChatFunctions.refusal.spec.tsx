import { renderHook, act } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TConversation, TMessage } from 'librechat-data-provider';
import useChatFunctions from '../useChatFunctions';

const mockNavigate = jest.fn();
const mockShowToast = jest.fn();
const mockSetShowStopButton = jest.fn();
const mockSetIsSubmitting = jest.fn();
const mockGetEphemeralAgent = jest.fn(() => null);
const mockSetFilesToDelete = jest.fn();
const mockGetSender = jest.fn(() => 'Assistant');
const mockGetExpiry = jest.fn(() => 'expiry-key');
const mockGetQueryData = jest.fn(() => ({}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: mockGetQueryData,
  }),
}));

jest.mock('recoil', () => ({
  useRecoilValue: () => false,
  useSetRecoilState: (atom: unknown) =>
    String(atom).includes('isSubmitting') ? mockSetIsSubmitting : mockSetShowStopButton,
  useRecoilCallback: (factory: any) =>
    factory({
      snapshot: {
        getLoadable: () => ({ state: 'hasValue', contents: [] }),
      },
      set: jest.fn(),
      reset: jest.fn(),
    }),
}));

jest.mock('~/hooks/Files/useSetFilesToDelete', () => () => mockSetFilesToDelete);
jest.mock('~/hooks/Conversations/useGetSender', () => () => mockGetSender);
jest.mock('~/hooks/Input/useUserKey', () => () => ({ getExpiry: mockGetExpiry }));
jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: null }),
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    isTemporary: 'isTemporary',
    isSubmittingFamily: () => 'isSubmitting',
    showStopButtonByIndex: () => 'showStopButton',
    pendingManualSkillsByConvoId: () => 'pendingManualSkills',
    messagesSiblingIdxFamily: () => 'messagesSiblingIdx',
  },
  useGetEphemeralAgent: () => mockGetEphemeralAgent,
}));
jest.mock('~/utils', () => ({
  logger: {
    log: jest.fn(),
    dir: jest.fn(),
  },
  createDualMessageContent: jest.fn(() => []),
  getRouteChatProjectId: jest.fn(() => null),
}));

const userMessage = (messageId: string, parentMessageId = '00000000-0000-0000-0000-000000000000') =>
  ({
    messageId,
    parentMessageId,
    conversationId: 'conversation-1',
    isCreatedByUser: true,
    sender: 'User',
    text: messageId,
  }) as TMessage;

const assistantMessage = (messageId: string, parentMessageId: string) =>
  ({
    messageId,
    parentMessageId,
    conversationId: 'conversation-1',
    isCreatedByUser: false,
    sender: 'Assistant',
    text: messageId,
  }) as TMessage;

const conversation = {
  conversationId: 'conversation-1',
  endpoint: EModelEndpoint.agents,
  model: 'gpt-4o',
  agent_id: 'agent-1',
} as TConversation;

const renderAsk = (isSubmitting: boolean, messages: TMessage[] = []) => {
  const setSubmission = jest.fn();
  const { result } = renderHook(() =>
    useChatFunctions({
      isSubmitting,
      latestMessage: messages[messages.length - 1] ?? null,
      conversation,
      getMessages: () => messages,
      setMessages: jest.fn(),
      setSubmission,
    }),
  );
  return { result, setSubmission };
};

/**
 * A refused submit must leave the chat exactly as it found it. `ask` returns `false` so the
 * caller can tell nothing was sent — `useSubmitMessage`/`AudioRecorder` keep the user's text
 * instead of resetting the composer over it, and `PlanCard` keeps its buttons. Refusals used
 * to return `undefined` (indistinguishable from success) and hid the Stop button on the way
 * out, which is how a chat pinned by a stale `isSubmitting` ate the text, blanked the plan
 * card's buttons, and stranded the running generation with no way to stop it — all silently,
 * and all only curable by an F5.
 */
describe('useChatFunctions ask refusals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetQueryData.mockReturnValue({});
  });

  it('refuses while a generation is running: says so, sends nothing, and leaves Stop alone', () => {
    const { result, setSubmission } = renderAsk(true);

    let returned: unknown;
    act(() => {
      returned = result.current.ask({ text: 'сравни CRM' });
    });

    expect(returned).toBe(false);
    expect(setSubmission).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_send_while_submitting' }),
    );
    // The refused call must not hide the Stop button of the generation it refused to
    // interrupt — that left the user with a running response and no way to stop it.
    expect(mockSetShowStopButton).not.toHaveBeenCalled();
  });

  it('refuses empty text silently — no toast, and the composer stays clearable', () => {
    const { result, setSubmission } = renderAsk(false);

    let returned: unknown;
    act(() => {
      returned = result.current.ask({ text: '   ' });
    });

    expect(setSubmission).not.toHaveBeenCalled();
    // An empty box explains itself; a toast here would be absurd.
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockSetShowStopButton).not.toHaveBeenCalled();
    // NOT `false`: there is no text to preserve, and `false` would stop useSubmitMessage
    // from clearing a whitespace-only composer — a behaviour change this fix has no
    // business making. Kept exactly as upstream had it.
    expect(returned).toBeUndefined();
  });

  it('an accepted submit still resets the Stop button', () => {
    const messages = [userMessage('user-1'), assistantMessage('assistant-1', 'user-1')];
    const { result, setSubmission } = renderAsk(false, messages);

    act(() => {
      result.current.regenerate(messages[0]);
    });

    expect(setSubmission).toHaveBeenCalled();
    expect(mockSetShowStopButton).toHaveBeenCalledWith(false);
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});
