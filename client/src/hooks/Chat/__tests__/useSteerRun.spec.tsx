import React from 'react';
import { RecoilRoot } from 'recoil';
import { buildTree } from 'librechat-data-provider';
import { renderHook, act } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import { drProgressByConvoId } from '~/store/deepResearch';
import useSteerRun from '../useSteerRun';

const mockSteerStream = jest.fn();
const mockShowToast = jest.fn();
const mockCtx = {
  conversation: { conversationId: 'c1' },
  isSubmitting: true,
  latestMessageId: 'resp1',
  getMessages: jest.fn(),
  setMessages: jest.fn(),
  files: new Map<string, unknown>(),
};

jest.mock('~/data-provider', () => ({
  steerStream: (...args: unknown[]) => mockSteerStream(...args),
}));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('~/Providers', () => ({
  useChatContext: () => mockCtx,
}));
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

const message = (over: Partial<TMessage>): TMessage =>
  ({ conversationId: 'c1', text: '', isCreatedByUser: false, ...over }) as TMessage;

const question = message({ messageId: 'um1', isCreatedByUser: true, text: 'Начать исследование' });
const running = message({ messageId: 'resp1', parentMessageId: 'um1', content: [] });

const renderSteer = (progress: unknown) =>
  renderHook(() => useSteerRun(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <RecoilRoot
        initializeState={({ set }) => {
          if (progress != null) {
            set(drProgressByConvoId('c1'), progress as never);
          }
        }}
      >
        {children}
      </RecoilRoot>
    ),
  });

const snapshot = (phase: string) => ({ phase, steps: [], action: '', sources: 0 });

describe('useSteerRun (mid-run steering)', () => {
  beforeEach(() => {
    mockSteerStream.mockReset();
    mockShowToast.mockReset();
    mockCtx.isSubmitting = true;
    mockCtx.getMessages.mockReset().mockReturnValue([question, running]);
    mockCtx.setMessages.mockReset();
    mockCtx.files = new Map();
    window.localStorage.clear();
  });

  it('refuses aloud when files are attached — they would ride along with the next ordinary message', async () => {
    mockCtx.files = new Map([['f1', {}]]);
    const { result } = renderSteer(snapshot('research'));
    let ok = true;
    await act(async () => {
      ok = await result.current.steer('с файлом');
    });
    expect(ok).toBe(false);
    expect(mockSteerStream).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_dr_steer_no_files',
      status: 'warning',
    });
  });

  it('is open only while the graph gathers: not before it (prepare/plan), not once the report is written', () => {
    expect(renderSteer(null).result.current.canSteer).toBe(false);
    expect(renderSteer(snapshot('prepare')).result.current.canSteer).toBe(false);
    expect(renderSteer(snapshot('plan')).result.current.canSteer).toBe(false);
    expect(renderSteer(snapshot('scope')).result.current.canSteer).toBe(true);
    expect(renderSteer(snapshot('research')).result.current.canSteer).toBe(true);
    const report = renderSteer(snapshot('report')).result.current;
    expect(report.canSteer).toBe(false);
    expect(report.steerClosed).toBe(true);
    mockCtx.isSubmitting = false;
    expect(renderSteer(snapshot('research')).result.current.canSteer).toBe(false);
  });

  it('on acceptance: the bubble joins the feed, the running answer moves under it, a toast confirms', async () => {
    const steerMsg = message({
      messageId: 's1',
      parentMessageId: 'um1',
      isCreatedByUser: true,
      text: 'не Минск',
      drKind: 'steer',
    });
    mockSteerStream.mockResolvedValue({ message: steerMsg, parentMessageId: 'um1', accepted: 1 });
    const { result } = renderSteer(snapshot('research'));

    let ok = false;
    await act(async () => {
      ok = await result.current.steer('  не Минск ');
    });
    expect(ok).toBe(true);
    expect(mockSteerStream).toHaveBeenCalledWith({ conversationId: 'c1', text: 'не Минск' });
    const next = mockCtx.setMessages.mock.calls[0][0] as TMessage[];
    /* The clarification BEFORE the answer it now parents: buildTree attaches a
     * message only to a parent that comes earlier in the array. Appended after
     * it, the answer became a lone root and the feed showed nothing else (seen
     * live, 21.09.2026). The real buildTree is the judge. */
    expect(next.map((m) => m.messageId)).toEqual(['um1', 's1', 'resp1']);
    expect(next.find((m) => m.messageId === 'resp1')?.parentMessageId).toBe('s1');
    const roots = buildTree({ messages: next }) ?? [];
    expect(roots.map((m) => m.messageId)).toEqual(['um1']);
    expect(roots[0].children?.[0].messageId).toBe('s1');
    expect(roots[0].children?.[0].children?.[0].messageId).toBe('resp1');
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_dr_steer_accepted',
      status: 'success',
    });
  });

  it('clears the PENDING draft: an accepted clarification must not come back into the field after the report', async () => {
    window.localStorage.setItem('textDraft_PENDING', 'draft-of-the-steer');
    window.localStorage.setItem('textDraft_c1', 'an unrelated earlier draft');
    mockSteerStream.mockResolvedValue({
      message: message({ messageId: 's1', parentMessageId: 'um1', isCreatedByUser: true }),
      parentMessageId: 'um1',
      accepted: 1,
    });
    const { result } = renderSteer(snapshot('research'));
    await act(async () => {
      await result.current.steer('не Минск');
    });
    expect(window.localStorage.getItem('textDraft_PENDING')).toBeNull();
    expect(window.localStorage.getItem('textDraft_c1')).toBe('an unrelated earlier draft');
  });

  it('a refused clarification keeps the PENDING draft — the text is still unsent', async () => {
    window.localStorage.setItem('textDraft_PENDING', 'draft-of-the-steer');
    mockSteerStream.mockRejectedValue({ response: { data: { error: 'нет' } } });
    const { result } = renderSteer(snapshot('research'));
    await act(async () => {
      await result.current.steer('поздно');
    });
    expect(window.localStorage.getItem('textDraft_PENDING')).toBe('draft-of-the-steer');
  });

  it('leaves an answer alone that does not hang under the head the server named', async () => {
    mockCtx.getMessages.mockReturnValue([
      question,
      message({ messageId: 'resp1', parentMessageId: 'other' }),
    ]);
    mockSteerStream.mockResolvedValue({
      message: message({ messageId: 's1', isCreatedByUser: true }),
      parentMessageId: 'um1',
      accepted: 1,
    });
    const { result } = renderSteer(snapshot('research'));
    await act(async () => {
      await result.current.steer('x');
    });
    const next = mockCtx.setMessages.mock.calls[0][0] as TMessage[];
    expect(next.find((m) => m.messageId === 'resp1')?.parentMessageId).toBe('other');
  });

  it("on refusal: the server's next step is the toast, nothing changes in the feed, the text stays", async () => {
    mockSteerStream.mockRejectedValue({
      response: { data: { error: 'Отчёт уже пишется — дождитесь его.', reason: 'report' } },
    });
    const { result } = renderSteer(snapshot('research'));
    let ok = true;
    await act(async () => {
      ok = await result.current.steer('поздно');
    });
    expect(ok).toBe(false);
    expect(mockCtx.setMessages).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Отчёт уже пишется — дождитесь его.',
      status: 'warning',
    });
  });

  it('a network failure gets the generic line', async () => {
    mockSteerStream.mockRejectedValue(new Error('offline'));
    const { result } = renderSteer(snapshot('research'));
    await act(async () => {
      await result.current.steer('x');
    });
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_dr_steer_failed',
      status: 'warning',
    });
  });

  it('sends nothing when closed, empty, or already in flight', async () => {
    mockSteerStream.mockReturnValue(new Promise(() => {}));
    const { result } = renderSteer(snapshot('research'));
    await act(async () => {
      expect(await result.current.steer('   ')).toBe(false);
    });
    act(() => {
      void result.current.steer('first');
    });
    expect(result.current.steerPending).toBe(true);
    await act(async () => {
      expect(await result.current.steer('second')).toBe(false);
    });
    expect(mockSteerStream).toHaveBeenCalledTimes(1);
  });
});
