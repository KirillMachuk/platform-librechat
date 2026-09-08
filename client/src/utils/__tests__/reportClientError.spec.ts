import {
  reportClientError,
  __resetClientErrorReporterForTests,
} from '../reportClientError';

describe('reportClientError', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    __resetClientErrorReporterForTests();
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  function bodyOf(call: number): Record<string, string> {
    return JSON.parse(fetchMock.mock.calls[call][1].body);
  }

  test('posts the failure to the receiver with the fields the server allows', () => {
    reportClientError('boundary', new TypeError('x is not a function'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/client-errors');
    const body = bodyOf(0);
    expect(body.kind).toBe('boundary');
    expect(body.message).toBe('TypeError: x is not a function');
    expect(typeof body.path).toBe('string');
  });

  test('sends the path only — the query string carries ids and a live reset token', () => {
    window.history.pushState({}, '', '/reset-password?token=853b7b62&userId=6a9d11e0');
    reportClientError('window', new Error('boom'));

    const body = bodyOf(0);
    expect(body.path).toBe('/reset-password');
    expect(JSON.stringify(body)).not.toContain('853b7b62');
  });

  test('a render loop repeating one failure is reported once, not sixty times', () => {
    const error = new Error('same failure');
    for (let i = 0; i < 50; i++) {
      reportClientError('boundary', error);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('different failures are still reported, up to the session ceiling', () => {
    for (let i = 0; i < 25; i++) {
      reportClientError('window', new Error(`failure ${i}`));
    }
    /* Ten is the ceiling: a session producing more is broken in a way one report
     * already tells us, and the point of the cap is to keep a broken tab from
     * filling the contour's error log. */
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  test('never throws, whatever it is handed', () => {
    expect(() => reportClientError('promise', undefined)).not.toThrow();
    expect(() => reportClientError('promise', { weird: true })).not.toThrow();
    expect(() => reportClientError('promise', 'a string reason')).not.toThrow();
  });

  test('a failing request stays silent — a reporter must not start its own loop', () => {
    fetchMock.mockReturnValue(Promise.reject(new Error('offline')));
    expect(() => reportClientError('window', new Error('boom'))).not.toThrow();
  });

  test('nothing to say means nothing is sent', () => {
    reportClientError('window', '');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
