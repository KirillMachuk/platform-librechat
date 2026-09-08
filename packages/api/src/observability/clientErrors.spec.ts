import { formatClientErrorMessage, sanitizeClientErrorReport } from './clientErrors';

describe('sanitizeClientErrorReport', () => {
  test('keeps the fields it knows and drops everything else', () => {
    const report = sanitizeClientErrorReport({
      kind: 'boundary',
      message: 'TypeError: x is not a function',
      stack: 'at Foo (bundle.js:1:2)',
      path: '/c/new',
      cookie: 'session=abc',
      body: 'the whole conversation',
    });
    expect(report).toEqual({
      kind: 'boundary',
      message: 'TypeError: x is not a function',
      stack: 'at Foo (bundle.js:1:2)',
      path: '/c/new',
    });
  });

  test('an unknown kind becomes "unknown" rather than being trusted', () => {
    expect(sanitizeClientErrorReport({ kind: 'reconcile', message: 'boom' })?.kind).toBe('unknown');
    expect(sanitizeClientErrorReport({ kind: 42, message: 'boom' })?.kind).toBe('unknown');
  });

  test('drops the query string: it carries ids, and reset links carry a live token', () => {
    expect(
      sanitizeClientErrorReport({
        message: 'boom',
        path: '/reset-password?token=853b7b62&userId=6a9d11e0',
      })?.path,
    ).toBe('/reset-password');
    expect(sanitizeClientErrorReport({ message: 'boom', path: '/c/abc#frag' })?.path).toBe(
      '/c/abc',
    );
  });

  test('clips long text so a stack cannot smuggle a document into the log', () => {
    const report = sanitizeClientErrorReport({
      message: 'x'.repeat(500),
      stack: 'y'.repeat(4000),
    });
    expect(report?.message.length).toBe(301);
    expect(report?.stack.length).toBe(1501);
    expect(report?.message.endsWith('…')).toBe(true);
  });

  test('collapses whitespace, so one failure groups as one line in the digest', () => {
    expect(sanitizeClientErrorReport({ message: '  a \n\n  b  ' })?.message).toBe('a b');
  });

  test('nothing to record returns null instead of an empty entry', () => {
    expect(sanitizeClientErrorReport(null)).toBeNull();
    expect(sanitizeClientErrorReport('a string')).toBeNull();
    expect(sanitizeClientErrorReport({})).toBeNull();
    expect(sanitizeClientErrorReport({ message: '   ' })).toBeNull();
    expect(sanitizeClientErrorReport({ message: 12345 })).toBeNull();
  });
});

describe('formatClientErrorMessage', () => {
  test('carries the prefix the daily digest files these under', () => {
    const report = sanitizeClientErrorReport({ kind: 'promise', message: 'Network error' });
    expect(report).not.toBeNull();
    expect(formatClientErrorMessage(report!)).toBe('[client] promise: Network error');
  });
});
