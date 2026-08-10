import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';
import RobotScene from './RobotScene';
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
    <div className="relative grid min-h-screen bg-presentation lg:grid-cols-2">
      {/* Owner's decision 10.08 (REDESIGN_Plan §1.5, after shadcn's login-02):
          the card column keeps the book's sign-in 1:1; the second column is a
          stage for a picture of the platform. One layout for every auth
          surface — login, registration, reset, 2FA — so none needs its own. */}
      {/* Page level, not column level: pinned to the column it sat at the
          seam between the two halves, which read as misplaced. z-10 keeps it
          above the picture column. */}
      <div className="absolute right-3 top-3 z-10">
        <ThemeSelector returnThemeOnly />
      </div>

      <div className="relative flex min-h-screen flex-col">
        <Banner />

        <main className="flex flex-grow flex-col items-center justify-center gap-4 px-4 py-8">
          <DisplayError />
          <div className="flex w-full max-w-[360px] flex-col gap-3.5 rounded-2xl border border-border-light bg-surface-primary p-5 shadow-sm md:p-7 md:pb-6">
            <div className="mb-1 flex flex-col items-center gap-[3px] text-center">
              {/* Знак живёт в коробке высотой со строку, которую занимает в
                прототипе набранное на его месте «1ma» (21px × 1,6 = 34 на
                десктопе, 22 × 1,6 = 35 на телефоне). Картинка своего
                межстрочного не несёт, поэтому без этой коробки подзаголовок
                подъезжает вплотную к знаку — владелец заметил это как «шрифт
                надписи будто выше», хотя сам шрифт уже совпадал. */}
              <div className="flex h-[35px] items-center md:h-[34px]">
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
              </div>
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

      {/* The picture side: the brand robot from the landing (owner's pick
          10.08 over the 21st.dev orb — that one had no stated license and
          drags three.js in). Same canvas colour as the form side (owner
          10.08 late: one background for both halves) — what sets this half
          apart is the landing's translucent 60px grid, fading upward the
          way the hero draws it. The faint wordmark stays underneath as the
          resting backdrop: it is what shows while the scene loads, if WebGL
          is unavailable, and for prefers-reduced-motion. */}
      <div className="relative hidden select-none bg-presentation lg:block" aria-hidden="true">
        {/* The mask sits on the <svg>, not the <rect> (Chromium ignores CSS
            masks on SVG children), and it is ONE linear layer on purpose:
            multiple mask layers composite as a union, which is how the
            landing's two-layer recipe quietly cancelled itself here. The
            fade is the point — without it the grid reads as a spreadsheet,
            with it the cells dissolve toward the top. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full text-border-medium"
          style={{
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 55%)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 55%)',
          }}
        >
          <defs>
            <pattern id="auth-grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect fill="url(#auth-grid)" width="100%" height="100%" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="assets/logo.svg"
            alt=""
            className="h-8 w-auto object-contain opacity-[0.12] dark:invert"
          />
        </div>
        <div className="absolute inset-0">
          <RobotScene scene="assets/spline/robot-v1.splinecode" />
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
