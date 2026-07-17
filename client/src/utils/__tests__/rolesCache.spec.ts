import type { TRole } from 'librechat-data-provider';
import { readRoleSnapshot, writeRoleSnapshot, clearRoleSnapshots } from '../rolesCache';

const role = (): TRole =>
  ({
    name: 'USER',
    permissions: { PROMPTS: { USE: true } },
  }) as unknown as TRole;

describe('rolesCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a valid role snapshot', () => {
    writeRoleSnapshot('USER', role());
    const snap = readRoleSnapshot('USER');
    expect(snap?.data).toEqual(role());
    expect(typeof snap?.updatedAt).toBe('number');
  });

  it('returns undefined when no snapshot exists', () => {
    expect(readRoleSnapshot('ADMIN')).toBeUndefined();
  });

  it('ignores a snapshot without a permissions object', () => {
    localStorage.setItem(
      'roleSnapshot:USER',
      JSON.stringify({ data: { name: 'USER' }, updatedAt: Date.now() }),
    );
    expect(readRoleSnapshot('USER')).toBeUndefined();
  });

  it('ignores malformed JSON', () => {
    localStorage.setItem('roleSnapshot:USER', '{not json');
    expect(readRoleSnapshot('USER')).toBeUndefined();
  });

  it('does not persist an invalid role', () => {
    writeRoleSnapshot('USER', { name: 'USER' } as unknown as TRole);
    expect(localStorage.getItem('roleSnapshot:USER')).toBeNull();
  });

  it('clears only role snapshots, leaving other keys intact', () => {
    writeRoleSnapshot('USER', role());
    writeRoleSnapshot('ADMIN', role());
    localStorage.setItem('unrelated', 'keep-me');
    clearRoleSnapshots();
    expect(readRoleSnapshot('USER')).toBeUndefined();
    expect(readRoleSnapshot('ADMIN')).toBeUndefined();
    expect(localStorage.getItem('unrelated')).toBe('keep-me');
  });
});
