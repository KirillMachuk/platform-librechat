/** Canon §6.9: a status plate is a soft `err-soft` field with an `errc` hairline
 *  and text in `errc`; the raw red-* ramp it used to carry gave 1.9:1 in dark. */
export const ErrorMessage = ({ children }: { children: React.ReactNode }) => (
  <div
    role="alert"
    aria-live="assertive"
    className="rounded-xl border border-border-light bg-err-soft px-4 py-3 text-[13px] text-text-destructive"
  >
    {children}
  </div>
);
