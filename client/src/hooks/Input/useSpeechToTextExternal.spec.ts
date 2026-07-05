jest.mock('~/data-provider', () => ({ useSpeechToTextMutation: jest.fn() }));
jest.mock('@librechat/client', () => ({ useToastContext: jest.fn() }));
jest.mock('~/hooks', () => ({ useLocalize: jest.fn() }));
jest.mock('~/store', () => ({ __esModule: true, default: {} }));
jest.mock('./useGetAudioSettings', () => ({ __esModule: true, default: jest.fn() }));

import { isSttServiceUnavailable } from './useSpeechToTextExternal';

describe('isSttServiceUnavailable', () => {
  it('returns true when the backend reports a 503 outage', () => {
    expect(isSttServiceUnavailable({ response: { status: 503 } })).toBe(true);
  });

  it('returns false for non-503 HTTP errors', () => {
    expect(isSttServiceUnavailable({ response: { status: 500 } })).toBe(false);
    expect(isSttServiceUnavailable({ response: { status: 400 } })).toBe(false);
    expect(isSttServiceUnavailable({ response: {} })).toBe(false);
  });

  it('returns false for null, undefined, and non-object errors', () => {
    expect(isSttServiceUnavailable(null)).toBe(false);
    expect(isSttServiceUnavailable(undefined)).toBe(false);
    expect(isSttServiceUnavailable('boom')).toBe(false);
    expect(isSttServiceUnavailable(new Error('boom'))).toBe(false);
  });
});
