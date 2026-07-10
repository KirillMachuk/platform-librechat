import { ViolationTypes } from 'librechat-data-provider';
import type { UsageMetadata } from '~/stream/interfaces/IJobStore';
import type { PricingFns } from './transactions';
import { evaluateAgentTurnBalance, createAgentTurnBalanceGuard } from './balance';

const pricing: PricingFns = {
  getMultiplier: jest.fn().mockReturnValue(2),
  getCacheMultiplier: jest.fn().mockReturnValue(null),
};

const usage = (input: number, output: number, model = 'gpt-4'): UsageMetadata => ({
  input_tokens: input,
  output_tokens: output,
  model,
});

const balanceRecord = (tokenCredits: number) => ({ tokenCredits });

describe('evaluateAgentTurnBalance', () => {
  it('reports not exhausted when the balance comfortably covers in-flight spend', async () => {
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(1e12));
    const result = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing,
    });
    expect(result.exhausted).toBe(false);
    expect(result.spentCredits).toBeGreaterThan(0);
    expect(result.errorMessage).toBeUndefined();
    expect(findBalanceByUser).toHaveBeenCalledWith('u1');
  });

  it('reports exhausted with a token_balance error when spend exceeds the balance', async () => {
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(1));
    const result = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing,
    });
    expect(result.exhausted).toBe(true);
    expect(result.errorMessage).toEqual({
      type: ViolationTypes.TOKEN_BALANCE,
      balance: 1,
      tokenCost: result.spentCredits,
      promptTokens: 0,
    });
  });

  it('treats a missing balance record as zero credits (exhausted)', async () => {
    const findBalanceByUser = jest.fn().mockResolvedValue(null);
    const result = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(10, 10)],
      findBalanceByUser,
      pricing,
    });
    expect(result.exhausted).toBe(true);
    expect(result.balanceCredits).toBe(0);
  });

  it('sums spend across every collected usage entry', async () => {
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(1e12));
    const single = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing,
    });
    const triple = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500), usage(1000, 500), usage(1000, 500)],
      findBalanceByUser,
      pricing,
    });
    expect(triple.spentCredits).toBe(single.spentCredits * 3);
  });

  it('honors the boundary exactly: remaining <= buffer is exhausted, remaining > buffer is not', async () => {
    const probe = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser: jest.fn().mockResolvedValue(balanceRecord(1e12)),
      pricing,
    });
    const spent = probe.spentCredits;
    const buffer = 5000;

    const atBoundary = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser: jest.fn().mockResolvedValue(balanceRecord(spent + buffer)),
      bufferCredits: buffer,
      pricing,
    });
    expect(atBoundary.exhausted).toBe(true);

    const justAbove = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser: jest.fn().mockResolvedValue(balanceRecord(spent + buffer + 1)),
      bufferCredits: buffer,
      pricing,
    });
    expect(justAbove.exhausted).toBe(false);
  });

  it('never throws when a single usage entry cannot be priced', async () => {
    const throwingPricing: PricingFns = {
      getMultiplier: jest.fn(() => {
        throw new Error('no rate for model');
      }),
      getCacheMultiplier: jest.fn().mockReturnValue(null),
    };
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(1e12));
    const result = await evaluateAgentTurnBalance({
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing: throwingPricing,
    });
    // Unpriceable entry contributes 0 spend, so a funded balance stays healthy.
    expect(result.exhausted).toBe(false);
    expect(result.spentCredits).toBe(0);
  });
});

describe('createAgentTurnBalanceGuard', () => {
  it('is a no-op when disabled (no balance read, no stop)', async () => {
    const findBalanceByUser = jest.fn();
    const onExhausted = jest.fn();
    const guard = createAgentTurnBalanceGuard({
      enabled: false,
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing,
      onExhausted,
    });
    await guard.handle();
    await guard.handle();
    expect(findBalanceByUser).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('skips the first turn (already covered by the pre-request check)', async () => {
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(0));
    const onExhausted = jest.fn();
    const guard = createAgentTurnBalanceGuard({
      enabled: true,
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing,
      onExhausted,
    });
    await guard.handle();
    expect(findBalanceByUser).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('stops the run once when a later turn is over budget', async () => {
    const collectedUsage: UsageMetadata[] = [usage(1000, 500)];
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(1));
    const onExhausted = jest.fn();
    const guard = createAgentTurnBalanceGuard({
      enabled: true,
      user: 'u1',
      collectedUsage,
      findBalanceByUser,
      pricing,
      onExhausted,
    });
    await guard.handle(); // turn 1 — skipped
    await guard.handle(); // turn 2 — exhausted
    await guard.handle(); // turn 3 — already triggered, no repeat
    expect(onExhausted).toHaveBeenCalledTimes(1);
    const [errorMessage] = onExhausted.mock.calls[0];
    expect(errorMessage.type).toBe(ViolationTypes.TOKEN_BALANCE);
    expect(errorMessage.balance).toBe(1);
  });

  it('does not stop when a later turn is still funded', async () => {
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(1e12));
    const onExhausted = jest.fn();
    const guard = createAgentTurnBalanceGuard({
      enabled: true,
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing,
      onExhausted,
    });
    await guard.handle();
    await guard.handle();
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('fails open: a balance-read error lets the turn proceed instead of blocking', async () => {
    const findBalanceByUser = jest.fn().mockRejectedValue(new Error('db unavailable'));
    const onExhausted = jest.fn();
    const warn = jest.fn();
    const guard = createAgentTurnBalanceGuard({
      enabled: true,
      user: 'u1',
      collectedUsage: [usage(1000, 500)],
      findBalanceByUser,
      pricing,
      onExhausted,
      logger: { warn },
    });
    await guard.handle();
    await expect(guard.handle()).resolves.toBeUndefined();
    expect(onExhausted).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('reflects live in-flight usage growth between turns', async () => {
    const collectedUsage: UsageMetadata[] = [];
    const findBalanceByUser = jest.fn().mockResolvedValue(balanceRecord(1));
    const onExhausted = jest.fn();
    const guard = createAgentTurnBalanceGuard({
      enabled: true,
      user: 'u1',
      collectedUsage,
      findBalanceByUser,
      pricing,
      onExhausted,
    });
    await guard.handle(); // turn 1 skipped; no usage yet
    collectedUsage.push(usage(1000, 500)); // a turn's usage lands
    await guard.handle(); // turn 2 — now over the tiny balance
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });
});
