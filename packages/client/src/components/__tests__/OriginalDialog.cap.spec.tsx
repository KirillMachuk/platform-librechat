import { dialogContentBaseClassName } from '../OriginalDialog';

/**
 * Round 23, item 4. The primitive's phone cap used to be `max-w-11/12` — a
 * class Tailwind's maxWidth scale does not generate, so it emitted NO CSS and
 * every dialog without its own width rendered edge-to-edge on phones. The cap
 * must stay a real, generated arbitrary value.
 */
describe('OGDialogContent phone-safe width cap', () => {
  it('carries a real viewport-relative max-width, not a dead fraction', () => {
    expect(dialogContentBaseClassName).toContain('max-w-[calc(100vw-2rem)]');
    expect(dialogContentBaseClassName).not.toMatch(/max-w-\d+\/\d+/);
  });
});
