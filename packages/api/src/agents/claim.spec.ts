import { claimCollectedUsage } from './usage';

describe('claimCollectedUsage', () => {
  it('removes and returns all entries (atomic claim empties the source)', () => {
    const usage = [{ a: 1 }, { a: 2 }];
    const claimed = claimCollectedUsage(usage);
    expect(claimed).toEqual([{ a: 1 }, { a: 2 }]);
    expect(usage).toHaveLength(0);
  });

  it('a second claim on the same array returns [] (no double-spend)', () => {
    const usage = [{ a: 1 }];
    expect(claimCollectedUsage(usage)).toHaveLength(1);
    expect(claimCollectedUsage(usage)).toHaveLength(0);
  });

  it('returns [] for empty / null / undefined / non-array input', () => {
    expect(claimCollectedUsage([])).toEqual([]);
    expect(claimCollectedUsage(null)).toEqual([]);
    expect(claimCollectedUsage(undefined)).toEqual([]);
    expect(claimCollectedUsage('nope' as unknown as unknown[])).toEqual([]);
  });
});
