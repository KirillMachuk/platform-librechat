import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';
import { Banner } from '../Banners';
import Footer from './Footer';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto w-full max-w-[360px]">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto w-full max-w-[360px]">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a className="font-medium text-text-accent hover:underline" href="/forgot-password">
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto w-full max-w-[360px]">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  const showSocialLogin =
    !pathname.includes('2fa') && (pathname.includes('login') || pathname.includes('register'));

  return (
    <div className="relative flex min-h-screen flex-col bg-presentation">
      <Banner />
      {/* returnThemeOnly: the wrapper form of ThemeSelector positions itself
          absolutely at the bottom-left, and nesting that inside a positioned
          box threw the toggle 36px past the right edge of the page. */}
      <div className="absolute right-3 top-3">
        <ThemeSelector returnThemeOnly />
      </div>

      <main className="flex flex-grow flex-col items-center justify-center gap-4 px-4 py-8">
        <DisplayError />
        <div className="flex w-full max-w-[360px] flex-col gap-3.5 rounded-2xl border border-border-light bg-surface-primary p-5 shadow-sm md:p-7 md:pb-6">
          <div className="mb-1 flex flex-col items-center gap-[3px] text-center">
            <BlinkAnimation active={isFetching}>
              {/* Прототип рисует на этом месте «1ma» текстом 21/700 — это
                  заглушка под фирменный знак, который в один html-файл не
                  вложить. Знак остаётся картинкой (решение владельца 08.08),
                  но встаёт в тот же оптический размер: у книжного начертания
                  высота прописных ≈15px при ширине блока 42px, у знака при
                  16px высоты ширина выходит ≈47px. Раньше стояло 30px — вдвое
                  крупнее книги, и это было первым, что бросалось в глаза. */}
              <img
                src="assets/logo.svg"
                className="h-[17px] w-auto object-contain dark:invert md:h-4"
                width={1920}
                height={648}
                alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? '1ma' })}
              />
            </BlinkAnimation>
            {!hasStartupConfigError && !isFetching && header && (
              <h1
                className="text-[13px] font-normal text-text-tertiary"
                style={{ userSelect: 'none' }}
              >
                {header}
              </h1>
            )}
          </div>
          {showSocialLogin && <SocialLoginRender startupConfig={startupConfig} />}
          {children}
        </div>
      </main>
      <Footer startupConfig={startupConfig} />
    </div>
  );
}

export default AuthLayout;
