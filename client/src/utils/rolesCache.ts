import type { TRole } from 'librechat-data-provider';

/**
 * Cross-reload snapshot of role permission definitions.
 *
 * Sidebar menu items (Agents, Skills, Prompts, MCP) are gated by `useHasAccess`,
 * which reads `roles[user.role]`. Those role definitions arrive on a second
 * network hop (`GET /api/roles/:role`) that can only start after auth resolves,
 * so on a hard reload the gated items pop in noticeably later than the ungated
 * ones. Seeding the role query with a localStorage snapshot lets `useHasAccess`
 * resolve as soon as the user object is known, while a background refetch keeps
 * the permissions authoritative.
 *
 * Role definitions are global (keyed by role name, not per user) and the server
 * still enforces every permission, so a stale snapshot is a UI-visibility hint
 * only — never a source of truth.
 */

const PREFIX = 'roleSnapshot:';

export interface RoleSnapshot {
  data: TRole;
  updatedAt: number;
}

function isValidRole(data: unknown): data is TRole {
  return (
    data != null &&
    typeof data === 'object' &&
    typeof (data as { permissions?: unknown }).permissions === 'object' &&
    (data as { permissions?: unknown }).permissions != null
  );
}

export function readRoleSnapshot(roleName: string): RoleSnapshot | undefined {
  if (!roleName || typeof window === 'undefined') {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${roleName}`);
    if (raw == null) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<RoleSnapshot>;
    if (!isValidRole(parsed?.data) || typeof parsed?.updatedAt !== 'number') {
      return undefined;
    }
    return { data: parsed.data, updatedAt: parsed.updatedAt };
  } catch {
    return undefined;
  }
}

export function writeRoleSnapshot(roleName: string, data: TRole): void {
  if (!roleName || typeof window === 'undefined' || !isValidRole(data)) {
    return;
  }
  try {
    const snapshot: RoleSnapshot = { data, updatedAt: Date.now() };
    window.localStorage.setItem(`${PREFIX}${roleName}`, JSON.stringify(snapshot));
  } catch {
    /* localStorage unavailable or over quota — snapshot is best-effort */
  }
}

export function clearRoleSnapshots(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key != null && key.startsWith(PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}
