import { TStartupConfig } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

const legalLinkClassName =
  'text-[12.5px] text-text-accent underline decoration-transparent transition-all duration-200 hover:decoration-current focus:decoration-current';

function Footer({ startupConfig }: { startupConfig: TStartupConfig | null | undefined }) {
  const localize = useLocalize();
  if (!startupConfig) {
    return null;
  }
  const privacyPolicy = startupConfig.interface?.privacyPolicy;
  const termsOfService = startupConfig.interface?.termsOfService;

  const privacyPolicyRender = privacyPolicy?.externalUrl && (
    <a
      className={legalLinkClassName}
      href={privacyPolicy.externalUrl}
      // Removed for WCAG compliance
      // target={privacyPolicy.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_privacy_policy')}
    </a>
  );

  const termsOfServiceRender = termsOfService?.externalUrl && (
    <a
      className={legalLinkClassName}
      href={termsOfService.externalUrl}
      // Removed for WCAG compliance
      // target={termsOfService.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_terms_of_service')}
    </a>
  );

  return (
    <div
      className="m-4 flex flex-col items-center justify-center gap-2 text-center"
      role="contentinfo"
    >
      <p className="text-[12.5px] text-text-tertiary">{localize('com_auth_access_by_admin')}</p>
      {(privacyPolicyRender || termsOfServiceRender) && (
        <div className="flex items-center justify-center gap-2">
          {privacyPolicyRender}
          {privacyPolicyRender && termsOfServiceRender && (
            <div className="h-3 border-r border-border-light" />
          )}
          {termsOfServiceRender}
        </div>
      )}
    </div>
  );
}

export default Footer;
