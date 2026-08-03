import { join } from 'path';
import { readFileSync } from 'fs';

/**
 * The artifacts panel decides for itself whether to draw a desktop panel or a
 * phone bottom sheet, while its layout host decides whether to give it a
 * resizable column or a full-screen overlay. Those two decisions have to flip
 * at the same width: in any band where they disagree, the host reserves a
 * side column and the panel draws a phone sheet over the whole viewport.
 */
/**
 * Reads the single width each file switches on. Matching all of them rather
 * than the first is deliberate: a second `useMediaQuery` added to either file
 * would otherwise be invisible here, and the comparison below would quietly
 * start comparing whichever one happens to come first in the source.
 */
const readBreakpoint = (relativePath: string): number => {
  const source = readFileSync(join(__dirname, '..', '..', '..', relativePath), 'utf8');
  const widths = [...source.matchAll(/useMediaQuery\('\(max-width:\s*(\d+)px\)'\)/g)].map((match) =>
    Number(match[1]),
  );
  if (widths.length === 0) {
    throw new Error(`no useMediaQuery max-width breakpoint found in ${relativePath}`);
  }
  const distinct = [...new Set(widths)];
  if (distinct.length > 1) {
    throw new Error(`${relativePath} switches on more than one width: ${distinct.join(', ')}`);
  }
  return distinct[0];
};

describe('artifacts panel breakpoints', () => {
  const panel = () => readBreakpoint('components/Artifacts/Artifacts.tsx');
  const layoutHost = () => readBreakpoint('components/SidePanel/SidePanelGroup.tsx');

  it('reads a breakpoint from both the panel and its layout host', () => {
    expect(panel()).toBeGreaterThan(0);
    expect(layoutHost()).toBeGreaterThan(0);
  });

  /**
   * Known defect, fixed by the panel redesign (Ф1): the panel switches to its
   * phone layout at 868px while the layout host keeps the desktop split until
   * 767px, so every viewport from 768px to 868px gets both at once. The design
   * canon allows only 768 and 1024 as breakpoints.
   *
   * `failing` rather than `skip` on purpose: when the widths are made to agree
   * this test starts failing, which forces whoever fixes it to promote it to a
   * normal assertion instead of leaving a stale skip behind.
   */
  it.failing('switches the panel and its layout host at the same width', () => {
    expect(panel()).toBe(layoutHost());
  });
});
