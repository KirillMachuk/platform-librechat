import { resolveTrustedBundlerURL, getAllowedBundlerOrigins } from './sandpack';

describe('resolveTrustedBundlerURL (D10 — Sandpack bundler allowlist)', () => {
  const emptyEnv = {} as NodeJS.ProcessEnv;

  it('passes through undefined (unset → Sandpack built-in default)', () => {
    expect(resolveTrustedBundlerURL(undefined, emptyEnv)).toBeUndefined();
    expect(resolveTrustedBundlerURL('', emptyEnv)).toBeUndefined();
  });

  it('allows the official CodeSandbox bundler origins', () => {
    expect(
      resolveTrustedBundlerURL('https://sandpack-bundler.codesandbox.io', emptyEnv),
    ).toBe('https://sandpack-bundler.codesandbox.io');
    expect(resolveTrustedBundlerURL('https://bundler.codesandbox.io/foo', emptyEnv)).toBe(
      'https://bundler.codesandbox.io/foo',
    );
  });

  it('rejects a non-allowlisted https origin', () => {
    expect(resolveTrustedBundlerURL('https://evil.example/bundler', emptyEnv)).toBeUndefined();
  });

  it('rejects non-https URLs', () => {
    expect(
      resolveTrustedBundlerURL('http://sandpack-bundler.codesandbox.io', emptyEnv),
    ).toBeUndefined();
  });

  it('rejects malformed URLs', () => {
    expect(resolveTrustedBundlerURL('not a url', emptyEnv)).toBeUndefined();
  });

  it('allows an operator-approved self-host via SANDPACK_BUNDLER_ALLOWED_ORIGINS', () => {
    const env = {
      SANDPACK_BUNDLER_ALLOWED_ORIGINS: 'https://bundler.1ma.internal, https://other.example',
    } as NodeJS.ProcessEnv;
    expect(resolveTrustedBundlerURL('https://bundler.1ma.internal/x', env)).toBe(
      'https://bundler.1ma.internal/x',
    );
    // Path/query differences do not matter, only the origin must match.
    expect(resolveTrustedBundlerURL('https://other.example', env)).toBe('https://other.example');
    // A different origin still rejected.
    expect(resolveTrustedBundlerURL('https://not-listed.example', env)).toBeUndefined();
  });

  it('getAllowedBundlerOrigins merges defaults with env extras', () => {
    const env = {
      SANDPACK_BUNDLER_ALLOWED_ORIGINS: 'https://a.internal,https://b.internal',
    } as NodeJS.ProcessEnv;
    const origins = getAllowedBundlerOrigins(env);
    expect(origins).toContain('https://sandpack-bundler.codesandbox.io');
    expect(origins).toContain('https://a.internal');
    expect(origins).toContain('https://b.internal');
  });
});
