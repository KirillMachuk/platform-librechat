import React from 'react';
import i18n from 'i18next';
import { render } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import translationEn from '~/locales/en/translation.json';
import translationRu from '~/locales/ru/translation.json';
import appI18n from '~/locales/i18n';
import Error from '../Error';

jest.mock('../CodeBlock', () => ({
  __esModule: true,
  default: () => <div data-testid="generations-codeblock" />,
}));

const createI18n = (lng: 'en' | 'ru') => {
  const instance = i18n.createInstance();
  instance.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: translationEn },
      ru: { translation: translationRu },
    },
    interpolation: { escapeValue: false },
    /** Synchronous init so `t` is ready at first render (otherwise react-i18next
     *  falls back before resources load, masking language selection). */
    initImmediate: false,
    react: { useSuspense: false },
  });
  return instance;
};

const renderError = (text: string, lng: 'en' | 'ru' = 'en') =>
  render(
    <I18nextProvider i18n={createI18n(lng)}>
      <Error text={text} />
    </I18nextProvider>,
  );

const tokenBalanceText = JSON.stringify({
  type: 'token_balance',
  balance: 1250000,
  tokenCost: 5100000,
  promptTokens: 0,
});

describe('Error – token_balance rendering', () => {
  it('renders the localized balance message and hides the raw credit numbers (EN)', () => {
    const { container } = renderError(tokenBalanceText, 'en');
    expect(container.textContent).toContain("You've run out of available balance");
    expect(container.textContent).not.toContain('Insufficient Funds');
    expect(container.textContent).not.toContain('1250000');
    expect(container.textContent).not.toContain('5100000');
  });

  it('ships the balance message key in both en and ru (no production fallback)', () => {
    expect(translationEn['com_error_token_balance']).toEqual(expect.any(String));
    expect(translationEn['com_error_token_balance']).not.toHaveLength(0);
    expect(translationRu['com_error_token_balance']).toEqual(expect.any(String));
    expect(translationRu['com_error_token_balance']).toMatch(/[а-яА-Я]/);
  });

  it('still renders the generations debug block when present', () => {
    const withGenerations = JSON.stringify({
      type: 'token_balance',
      balance: 0,
      tokenCost: 100,
      promptTokens: 0,
      generations: [{ foo: 'bar' }],
    });
    const { queryByTestId, container } = renderError(withGenerations, 'en');
    expect(container.textContent).toContain("You've run out of available balance");
    expect(queryByTestId('generations-codeblock')).toBeTruthy();
  });
});

/** The suite-wide react-i18next mock (test/setupTests.js) ignores I18nextProvider and reads the
 *  app's own i18n instance, so language is switched there — and the ru bundle, which the app
 *  lazy-loads, is registered by hand first. */
describe('Error – a plain message keeps one language', () => {
  const serverMessage = 'Модель не вернула ответ. Повторите запрос.';

  afterEach(async () => {
    await appI18n.changeLanguage('en');
  });

  it('does not put an English lead-in in front of a Russian message', async () => {
    appI18n.addResourceBundle('ru', 'translation', translationRu, true, true);
    await appI18n.changeLanguage('ru');

    const { container } = render(<Error text={serverMessage} />);

    expect(container.textContent).toContain(serverMessage);
    expect(container.textContent).not.toContain('Something went wrong');
  });

  it('leaves the English wording as it was', () => {
    const { container } = render(<Error text="Upstream exploded" />);

    expect(container.textContent).toBe(
      "Something went wrong. Here's the specific error message we encountered: Upstream exploded",
    );
  });
});

/**
 * The error bubble looks up its handler by a key taken from the error body:
 * `errorMessages[json.code || json.type]`. An object literal inherits
 * `Object.prototype`, so keys that exist there resolve to methods nobody
 * registered — and the bubble calls whatever it found. Found by an independent
 * security review of the vision-error work.
 */
describe('Error – a key nobody registered', () => {
  it('does not call an inherited Object method as if it were a handler', () => {
    const { container } = renderError(JSON.stringify({ code: 'hasOwnProperty' }), 'en');

    expect(container.textContent).toContain('Something went wrong');
  });

  it('survives a key that resolves to a constructor', () => {
    const { container } = renderError(JSON.stringify({ code: 'constructor' }), 'en');

    expect(container.textContent).toContain('Something went wrong');
  });

  it('still routes a key that really is registered', () => {
    const { container } = renderError(JSON.stringify({ code: 'invalid_api_key' }), 'en');

    expect(container.textContent).toContain('Invalid API key');
  });
});

/**
 * Long errors are cut to 512 characters — unless the text happens to contain a
 * balanced pair of braces, because the cut is skipped whenever `extractJson`
 * finds one, and `extractJson` matches braces, not JSON.
 */
describe('Error – a long message stays cut', () => {
  it('cuts a long message that merely mentions braces', () => {
    const long = `a {not json} ${'x'.repeat(900)}`;

    const { container } = renderError(long, 'en');

    expect(container.textContent).toContain('...');
    expect(container.textContent!.length).toBeLessThan(700);
  });
});
