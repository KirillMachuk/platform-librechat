import React from 'react';
import { RecoilRoot } from 'recoil';
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
    expect(next.map((m) => m.messageId)).toEqual(['um1', 'resp1', 's1']);
    expect(next.find((m) => m.messageId === 'resp1')?.parentMessageId).toBe('s1');
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_dr_steer_accepted',
      status: 'success',
    });
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
