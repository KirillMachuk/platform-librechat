import React, { useContext, useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginPage } from 'librechat-data-provider';
import { Turnstile } from '@marsidev/react-turnstile';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { useRegisterUserMutation } from 'librechat-data-provider/react-query';
import { ThemeContext, SecretInput, Spinner, Button, isDark } from '@librechat/client';
import type { TRegisterUser, TError } from 'librechat-data-provider';
import type { TLoginLayoutContext } from '~/common';
import { AuthField, authFieldClassName, errorId } from './Field';
import { useLocalize, TranslationKeys } from '~/hooks';
import { ErrorMessage } from './ErrorMessage';

const Registration: React.FC = () => {
  const navigate = useNavigate();
  const localize = useLocalize();
  const { theme } = useContext(ThemeContext);
  const { startupConfig, startupConfigError, isFetching } = useOutletContext<TLoginLayoutContext>();

  const {
    watch,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TRegisterUser>({ mode: 'onTouched', reValidateMode: 'onChange' });
  const password = watch('password');

  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState<number>(3);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const token = queryParams.get('token');
  const validTheme = isDark(theme) ? 'dark' : 'light';

  // only require captcha if we have a siteKey
  const requireCaptcha = Boolean(startupConfig?.turnstile?.siteKey);

  const registerUser = useRegisterUserMutation({
    onMutate: () => {
      setIsSubmitting(true);
    },
    onSuccess: () => {
      setIsSubmitting(false);
      setCountdown(3);
      const timer = setInterval(() => {
        setCountdown((prevCountdown) => {
          if (prevCountdown <= 1) {
            clearInterval(timer);
            navigate('/c/new', { replace: true });
            return 0;
          } else {
            return prevCountdown - 1;
          }
        });
      }, 1000);
    },
    onError: (error: unknown) => {
      setIsSubmitting(false);
      if ((error as TError).response?.data?.message) {
        setErrorMessage((error as TError).response?.data?.message ?? '');
      }
    },
  });

  const renderInput = (id: string, label: TranslationKeys, type: string, validation: object) => {
    const fieldLabel = localize(label);
    const field = register(
      id as 'name' | 'email' | 'username' | 'password' | 'confirm_password',
      validation,
    );
    const message = errors[id] ? String(errors[id]?.message ?? '') : undefined;
    /** A saved password must not be offered as a NEW one, and a fresh one has
     *  to be offerable — `autoComplete={id}` produced neither. */
    const autoComplete = type === 'password' ? 'new-password' : id;

    return (
      <AuthField key={id} id={id} label={fieldLabel} error={message}>
        {type === 'password' ? (
          <SecretInput
            id={id}
            autoComplete={autoComplete}
            {...field}
            aria-invalid={!!errors[id]}
            aria-describedby={message ? errorId(id) : undefined}
            className={authFieldClassName(!!errors[id])}
            data-testid={id}
            showSecretLabel={localize('com_auth_password_show')}
            hideSecretLabel={localize('com_auth_password_hide')}
          />
        ) : (
          <input
            id={id}
            type={type}
            autoComplete={autoComplete}
            {...field}
            aria-invalid={!!errors[id]}
            aria-describedby={message ? errorId(id) : undefined}
            className={authFieldClassName(!!errors[id])}
            data-testid={id}
          />
        )}
      </AuthField>
    );
  };

  return (
    <>
      {errorMessage && (
        <ErrorMessage>
          {localize('com_auth_error_create')} {errorMessage}
        </ErrorMessage>
      )}
      {registerUser.isSuccess && countdown > 0 && (
        <div
          className="rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-[13px] text-text-secondary"
          role="alert"
        >
          {localize(
            startupConfig?.emailEnabled
              ? 'com_auth_registration_success_generic'
              : 'com_auth_registration_success_insecure',
          ) +
            ' ' +
            localize('com_auth_email_verification_redirecting', { 0: countdown.toString() })}
        </div>
      )}
      {!startupConfigError && !isFetching && (
        <>
          <form
            className="flex flex-col gap-3"
            aria-label={localize('com_ui_form_registration')}
            method="POST"
            onSubmit={handleSubmit((data: TRegisterUser) =>
              registerUser.mutate({ ...data, token: token ?? undefined }),
            )}
          >
            {renderInput('name', 'com_auth_full_name', 'text', {
              required: localize('com_auth_name_required'),
              minLength: {
                value: 3,
                message: localize('com_auth_name_min_length'),
              },
              maxLength: {
                value: 80,
                message: localize('com_auth_name_max_length'),
              },
            })}
            {renderInput('username', 'com_auth_username', 'text', {
              minLength: {
                value: 2,
                message: localize('com_auth_username_min_length'),
              },
              maxLength: {
                value: 80,
                message: localize('com_auth_username_max_length'),
              },
            })}
            {renderInput('email', 'com_auth_email_address', 'email', {
              required: localize('com_auth_email_required'),
              minLength: {
                value: 1,
                message: localize('com_auth_email_min_length'),
              },
              maxLength: {
                value: 120,
                message: localize('com_auth_email_max_length'),
              },
              pattern: {
                value: /\S+@\S+\.\S+/,
                message: localize('com_auth_email_pattern'),
              },
            })}
            {renderInput('password', 'com_auth_password', 'password', {
              required: localize('com_auth_password_required'),
              minLength: {
                value: startupConfig?.minPasswordLength || 8,
                message: localize('com_auth_password_min_length'),
              },
              maxLength: {
                value: 128,
                message: localize('com_auth_password_max_length'),
              },
            })}
            {renderInput('confirm_password', 'com_auth_password_confirm', 'password', {
              validate: (value: string) =>
                value === password || localize('com_auth_password_not_match'),
            })}

            {startupConfig?.turnstile?.siteKey && (
              <div className="flex justify-center">
                <Turnstile
                  siteKey={startupConfig.turnstile.siteKey}
                  options={{
                    ...startupConfig.turnstile.options,
                    theme: validTheme,
                  }}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onError={() => setTurnstileToken(null)}
                  onExpire={() => setTurnstileToken(null)}
                />
              </div>
            )}

            <Button
              disabled={isSubmitting || (requireCaptcha && !turnstileToken)}
              type="submit"
              data-testid="registration-button"
              variant="submit"
              className="mt-1 h-12 w-full rounded-xl text-[15px] sm:h-10 sm:text-sm"
            >
              {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
            </Button>
          </form>

          <p className="mt-1 text-center text-[13px] text-text-tertiary">
            {localize('com_auth_already_have_account')}{' '}
            <a
              href={loginPage()}
              className="tap-target inline-block text-text-accent hover:underline"
            >
              {localize('com_auth_login')}
            </a>
          </p>
        </>
      )}
    </>
  );
};

export default Registration;
