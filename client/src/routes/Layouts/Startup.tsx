import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { TStartupConfig } from 'librechat-data-provider';
import { TranslationKeys, useDocumentTitle, useLocalize } from '~/hooks';
import { REDIRECT_PARAM, SESSION_KEY, isChatRoute } from '~/utils';
import { useGetStartupConfig } from '~/data-provider';
import AuthLayout from '~/components/Auth/AuthLayout';

const headerMap: Record<string, TranslationKeys> = {
  '/login': 'com_auth_welcome_back',
  '/register': 'com_auth_create_account',
  '/forgot-password': 'com_auth_reset_password',
  '/reset-password': 'com_auth_reset_password',
  '/login/2fa': 'com_auth_verify_your_identity',
};

export default function StartupLayout({ isAuthenticated }: { isAuthenticated?: boolean }) {
  const [error, setError] = useState<TranslationKeys | null>(null);
  const [headerText, setHeaderText] = useState<TranslationKeys | null>(null);
  const [startupConfig, setStartupConfig] = useState<TStartupConfig | null>(null);
  const {
    data,
    isFetching,
    error: startupConfigError,
  } = useGetStartupConfig({
    enabled: isAuthenticated ? startupConfig === null : true,
  });
  const localize = useLocalize();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      const hasPendingRedirect =
        new URLSearchParams(window.location.search).has(REDIRECT_PARAM) ||
        sessionStorage.getItem(SESSION_KEY) != null;
      // Already inside a chat route (including /projects/<id>/c/...) means
      // the user landed on a deep-linked chat — don't bounce them to /c/new.
      const alreadyOnChat = isChatRoute(location.pathname);
      if (!hasPendingRedirect && !alreadyOnChat) {
        navigate('/c/new', { replace: true });
      }
    }
    if (data) {
      setStartupConfig(data);
    }
  }, [isAuthenticated, navigate, data, location.pathname]);

  /* Заголовок вкладки — свой на каждый маршрут (§9 приёмки): вкладки, история
     и закладки трёх экранов входа были неразличимы. Ключ берётся из того же
     headerMap, что и подпись под знаком, поэтому вторая карта не заводится. */
  const appTitle = startupConfig?.appTitle || '1ma';
  const routeTitleKey = headerMap[location.pathname];
  useDocumentTitle(routeTitleKey ? `${localize(routeTitleKey)} | ${appTitle}` : appTitle);

  useEffect(() => {
    setError(null);
    setHeaderText(null);
  }, [location.pathname]);

  const contextValue = {
    error,
    setError,
    headerText,
    setHeaderText,
    startupConfigError,
    startupConfig,
    isFetching,
  };

  return (
    <AuthLayout
      header={headerText ? localize(headerText) : localize(headerMap[location.pathname])}
      isFetching={isFetching}
      startupConfig={startupConfig}
      startupConfigError={startupConfigError}
      pathname={location.pathname}
      error={error}
    >
      <Outlet context={contextValue} />
    </AuthLayout>
  );
}
