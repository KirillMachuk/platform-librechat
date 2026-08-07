import React, { useState, useEffect, useContext } from 'react';
import { useForm } from 'react-hook-form';
import { Turnstile } from '@marsidev/react-turnstile';
import { ThemeContext, SecretInput, Spinner, Button, isDark } from '@librechat/client';
import type { TLoginUser, TStartupConfig } from 'librechat-data-provider';
import type { TAuthContext } from '~/common';
import { useResendVerificationEmail, useGetStartupConfig } from '~/data-provider';
import { AuthField, authFieldClassName, errorId } from './Field';
import { validateEmail } from '~/utils';
import { useLocalize } from '~/hooks';

type TLoginFormProps = {
  onSubmit: (data: TLoginUser) => void;
  startupConfig: TStartupConfig;
  error: Pick<TAuthContext, 'error'>['error'];
  setError: Pick<TAuthContext, 'setError'>['setError'];
};

const LoginForm: React.FC<TLoginFormProps> = ({ onSubmit, startupConfig, error, setError }) => {
  const localize = useLocalize();
  const { theme } = useContext(ThemeContext);
  const {
    register,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TLoginUser>({ mode: 'onTouched', reValidateMode: 'onChange' });
  const [showResendLink, setShowResendLink] = useState<boolean>(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const { data: config } = useGetStartupConfig();
  const useUsernameLogin = config?.ldap?.username;
  const validTheme = isDark(theme) ? 'dark' : 'light';
  const requireCaptcha = Boolean(startupConfig.turnstile?.siteKey);

  /** Canon §6.1: one ink action per screen. With corporate sign-in on the card
   *  that button is the main action and the password form submits with an
   *  outline; without it the password form is the only way in. */
  const hasSocialLogin =
    startupConfig.socialLoginEnabled === true && (startupConfig.socialLogins?.length ?? 0) > 0;

  useEffect(() => {
    if (error && error.includes('422') && !showResendLink) {
      setShowResendLink(true);
    }
  }, [error, showResendLink]);

  const resendLinkMutation = useResendVerificationEmail({
    onMutate: () => {
      setError(undefined);
      setShowResendLink(false);
    },
  });

  if (!startupConfig) {
    return null;
  }

  const handleResendEmail = () => {
    const email = getValues('email');
    if (!email) {
      return setShowResendLink(false);
    }
    resendLinkMutation.mutate({ email });
  };

  const emailError = errors.email?.message as string | undefined;
  const passwordError = errors.password?.message as string | undefined;

  return (
    <>
      {showResendLink && (
        <div className="rounded-xl border border-border-light bg-surface-secondary px-3 py-2 text-[12.5px] text-text-secondary">
          {localize('com_auth_email_verification_resend_prompt')}
          <button
            type="button"
            className="ml-2 text-text-accent hover:underline"
            onClick={handleResendEmail}
            disabled={resendLinkMutation.isLoading}
          >
            {localize('com_auth_email_resend_link')}
          </button>
        </div>
      )}
      <form
        className="flex flex-col gap-3"
        aria-label={localize('com_ui_form_login')}
        method="POST"
        onSubmit={handleSubmit((data) => onSubmit(data))}
      >
        <AuthField
          id="email"
          label={
            useUsernameLogin
              ? localize('com_auth_username').replace(/ \(.*$/, '')
              : localize('com_auth_email_address')
          }
          error={emailError}
        >
          <input
            type="text"
            id="email"
            autoComplete={useUsernameLogin ? 'username' : 'email'}
            {...register('email', {
              required: localize('com_auth_email_required'),
              maxLength: { value: 120, message: localize('com_auth_email_max_length') },
              validate: useUsernameLogin
                ? undefined
                : (value) => validateEmail(value, localize('com_auth_email_pattern')),
            })}
            aria-invalid={!!errors.email}
            aria-describedby={emailError ? errorId('email') : undefined}
            className={authFieldClassName(!!errors.email)}
            placeholder={useUsernameLogin ? undefined : localize('com_auth_email_placeholder')}
          />
        </AuthField>
        <AuthField id="password" label={localize('com_auth_password')} error={passwordError}>
          <SecretInput
            id="password"
            autoComplete="current-password"
            {...register('password', {
              required: localize('com_auth_password_required'),
              minLength: {
                value: startupConfig?.minPasswordLength || 8,
                message: localize('com_auth_password_min_length'),
              },
              maxLength: { value: 128, message: localize('com_auth_password_max_length') },
            })}
            aria-invalid={!!errors.password}
            aria-describedby={passwordError ? errorId('password') : undefined}
            className={authFieldClassName(!!errors.password)}
            showSecretLabel={localize('com_auth_password_show')}
            hideSecretLabel={localize('com_auth_password_hide')}
          />
        </AuthField>

        {requireCaptcha && (
          <div className="flex justify-center">
            <Turnstile
              siteKey={startupConfig.turnstile!.siteKey}
              options={{
                ...startupConfig.turnstile!.options,
                theme: validTheme,
              }}
              onSuccess={setTurnstileToken}
              onError={() => setTurnstileToken(null)}
              onExpire={() => setTurnstileToken(null)}
            />
          </div>
        )}

        <Button
          data-testid="login-button"
          type="submit"
          disabled={(requireCaptcha && !turnstileToken) || isSubmitting}
          variant={hasSocialLogin ? 'outline' : 'submit'}
          /** Canon §4: the one wide button on the sign-in card is 40 (48 on a
           *  phone), taller than the 36 every other button gets. The `outline`
           *  variant now carries `btn-line` and a plain `hover` fill on its
           *  own, so the patch that used to live here is gone. */
          className="mt-1 h-12 w-full text-[15px] md:h-10 md:text-sm"
        >
          {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
        </Button>
        {startupConfig.passwordResetEnabled && (
          <a
            href="/forgot-password"
            className="tap-target mt-1 inline-block self-center text-[13px] text-text-accent hover:underline"
          >
            {localize('com_auth_password_forgot')}
          </a>
        )}
      </form>
    </>
  );
};

export default LoginForm;
