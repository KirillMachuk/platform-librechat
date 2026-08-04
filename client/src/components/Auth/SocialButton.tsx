import React from 'react';

/** Canon §1.1/§6.1: the corporate sign-in is the one ink action on the card. */
const SocialButton = ({ id, enabled, serverDomain, oauthPath, Icon, label }) => {
  if (!enabled) {
    return null;
  }

  return (
    <a
      className="flex h-12 w-full items-center justify-center gap-[7px] rounded-xl bg-ink px-4 text-[15px] font-medium text-ink-label transition-opacity duration-90 hover:opacity-[0.86] sm:h-10 sm:text-sm"
      href={`${serverDomain}/oauth/${oauthPath}`}
      data-testid={id}
    >
      <Icon />
      <span>{label}</span>
    </a>
  );
};

export default SocialButton;
