import { useState, ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Spinner, Button } from '@librechat/client';
import { useOutletContext } from 'react-router-dom';
import { loginPage } from 'librechat-data-provider';
import { useRequestPasswordResetMutation } from 'librechat-data-provider/react-query';
import type { TRequestPasswordReset, TRequestPasswordResetResponse } from 'librechat-data-provider';
import type { FC } from 'react';
import type { TLoginLayoutContext } from '~/common';
import { AuthField, authFieldClassName, errorId } from './Field';
import { useLocalize } from '~/hooks';

const BodyTextWrapper: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <div
      className="rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-[13px] text-text-secondary"
      role="alert"
    >
      {children}
    </div>
  );
};

const ResetPasswordBodyText = () => {
  const localize = useLocalize();
  return (
    <div className="flex flex-col space-y-4">
      <p>{localize('com_auth_reset_password_if_email_exists')}</p>
      <a className="text-[13px] text-text-accent hover:underline" href={loginPage()}>
        {localize('com_auth_back_to_login')}
      </a>
    </div>
  );
};

function RequestPasswordReset() {
  const localize = useLocalize();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TRequestPasswordReset>();
  const [bodyText, setBodyText] = useState<ReactNode | undefined>(undefined);
  const { startupConfig, setHeaderText } = useOutletContext<TLoginLayoutContext>();

  const requestPasswordReset = useRequestPasswordResetMutation();
  const { isLoading } = requestPasswordReset;

  const onSubmit = (data: TRequestPasswordReset) => {
    requestPasswordReset.mutate(data, {
      onSuccess: (data: TRequestPasswordResetResponse) => {
        if (data.link && !startupConfig?.emailEnabled) {
          setHeaderText('com_auth_reset_password');
          setBodyText(
            <span>
              {localize('com_auth_click')}{' '}
              <a className="text-text-accent hover:underline" href={data.link}>
                {localize('com_auth_here')}
              </a>{' '}
              {localize('com_auth_to_reset_your_password')}
            </span>,
          );
        } else {
          setHeaderText('com_auth_reset_password_link_sent');
          setBodyText(<ResetPasswordBodyText />);
        }
      },
      onError: () => {
        setHeaderText('com_auth_reset_password_link_sent');
        setBodyText(<ResetPasswordBodyText />);
      },
    });
  };

  if (bodyText) {
    return <BodyTextWrapper>{bodyText}</BodyTextWrapper>;
  }

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={localize('com_ui_form_password_reset')}
      method="POST"
      onSubmit={handleSubmit(onSubmit)}
    >
      <AuthField
        id="email"
        label={localize('com_auth_email_address')}
        error={errors.email?.message}
      >
        <input
          type="email"
          id="email"
          autoComplete="email"
          {...register('email', {
            required: localize('com_auth_email_required'),
            minLength: {
              value: 3,
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
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? errorId('email') : undefined}
          className={authFieldClassName(!!errors.email)}
          placeholder={localize('com_auth_email_placeholder')}
        />
      </AuthField>
      <Button
        type="submit"
        data-testid="request-password-reset-button"
        disabled={isLoading}
        variant="submit"
        className="mt-1 h-12 w-full rounded-xl text-[15px] sm:h-10 sm:text-sm"
      >
        {isLoading ? <Spinner /> : localize('com_auth_continue')}
      </Button>
      <a href={loginPage()} className="self-center text-[13px] text-text-accent hover:underline">
        {localize('com_auth_back_to_login')}
      </a>
    </form>
  );
}

export default RequestPasswordReset;
