import React from 'react';

/** Canon §1.1/§6.1: the corporate sign-in is the one ink action on the card. */
const SocialButton = ({ id, enabled, serverDomain, oauthPath, Icon, label }) => {
  if (!enabled) {
    return null;
  }

  return (
    <a
      /* `md:`, not `sm:` — the canon has two breakpoints, 768 and 1024. Tailwind's
         default `sm:` is 640, so between 640 and 767 this button was already
         wearing its desktop height on what is still a phone by the book. */
      className="flex h-12 w-full items-center justify-center gap-[7px] rounded-xl bg-ink px-4 text-[15px] font-medium text-ink-label transition-opacity duration-90 hover:opacity-[0.86] md:h-10 md:text-sm"
      href={`${serverDomain}/oauth/${oauthPath}`}
      data-testid={id}
    >
      <Icon />
      <span>{label}</span>
    </a>
  );
};

export default SocialButton;
