import { useForm } from 'react-hook-form';
import { useOutletContext } from 'react-router-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spinner, Button, SecretInput } from '@librechat/client';
import { useResetPasswordMutation } from 'librechat-data-provider/react-query';
import type { TResetPassword } from 'librechat-data-provider';
import type { TLoginLayoutContext } from '~/common';
import { AuthField, authFieldClassName, errorId } from './Field';
import { useLocalize } from '~/hooks';

function ResetPassword() {
  const localize = useLocalize();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TResetPassword>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const password = watch('password');
  const resetPassword = useResetPasswordMutation();
  const { setError, setHeaderText, startupConfig } = useOutletContext<TLoginLayoutContext>();

  const onSubmit = (data: TResetPassword) => {
    resetPassword.mutate(data, {
      onError: () => {
        setError('com_auth_error_invalid_reset_token');
      },
      onSuccess: () => {
        setHeaderText('com_auth_reset_password_success');
      },
    });
  };

  if (resetPassword.isSuccess) {
    return (
      <>
        <div className="flex flex-col gap-3" role="alert">
          <p className="text-[13px] text-text-secondary">
            {localize('com_auth_login_with_new_password')}
          </p>
          <Button
            onClick={() => navigate('/login')}
            variant="submit"
            className="h-12 w-full rounded-xl text-[15px] md:h-10 md:text-sm"
          >
            {localize('com_auth_continue')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={localize('com_ui_form_password_reset')}
      method="POST"
      onSubmit={handleSubmit(onSubmit)}
    >
      <input
        type="hidden"
        id="token"
        value={params.get('token') ?? ''}
        {...register('token', { required: localize('com_auth_error_invalid_reset_token') })}
      />
      <input
        type="hidden"
        id="userId"
        value={params.get('userId') ?? ''}
        {...register('userId', { required: localize('com_auth_error_invalid_reset_token') })}
      />
      <AuthField
        id="password"
        label={localize('com_auth_password')}
        error={errors.password?.message}
      >
        <SecretInput
          id="password"
          autoComplete="new-password"
          {...register('password', {
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
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? errorId('password') : undefined}
          className={authFieldClassName(!!errors.password)}
          showSecretLabel={localize('com_auth_password_show')}
          hideSecretLabel={localize('com_auth_password_hide')}
        />
      </AuthField>
      <AuthField
        id="confirm_password"
        label={localize('com_auth_password_confirm')}
        error={errors.confirm_password?.message ?? errors.token?.message ?? errors.userId?.message}
      >
        <SecretInput
          id="confirm_password"
          autoComplete="new-password"
          {...register('confirm_password', {
            validate: (value) => value === password || localize('com_auth_password_not_match'),
          })}
          aria-invalid={!!errors.confirm_password}
          aria-describedby={errors.confirm_password ? errorId('confirm_password') : undefined}
          className={authFieldClassName(!!errors.confirm_password)}
          showSecretLabel={localize('com_auth_password_show')}
          hideSecretLabel={localize('com_auth_password_hide')}
        />
      </AuthField>
      <Button
        type="submit"
        data-testid="reset-password-button"
        disabled={isSubmitting}
        variant="submit"
        className="mt-1 h-12 w-full rounded-xl text-[15px] md:h-10 md:text-sm"
      >
        {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
      </Button>
    </form>
  );
}

export default ResetPassword;
