import { render, screen } from '@testing-library/react';
import { Button, FIELD_BASE, FIELD_BORDER, CHIP_BASE, CHIP_CHECKED } from '@librechat/client';

/**
 * The canon numbers for the two shared controls, asserted on the class string
 * the browser actually receives rather than on the source that produced it.
 *
 * That distinction is the whole point. `Button` runs its variants through
 * `twMerge`, which silently drops whichever conflicting class it decides lost —
 * so `rounded-lg` on the icon size only beats `rounded-xl` on the base because
 * of the order cva emits them in. Reading the file tells you nothing about the
 * outcome; the resolved string does. The fork has been burned by exactly this
 * before, with a `render` prop that concatenated classes instead of merging.
 */
/** Children go through a variable: the i18n lint rule bans literals in JSX,
 *  and it is right to — even here the label is not what is being tested. */
const LABEL = 'Готово';

const classesOf = (ui: React.ReactElement) => {
  render(ui);
  return screen.getByRole('button').className.split(/\s+/);
};

describe('the canon a button carries', () => {
  it('is 36 high with radius 12, and reaches 44 for a finger', () => {
    const c = classesOf(<Button>{LABEL}</Button>);

    expect(c).toContain('h-9');
    expect(c).toContain('rounded-xl');
    expect(c).not.toContain('rounded-lg');
    expect(c).toContain('px-4');
    /* Canon §4: 36 is under the 44 a finger needs, so the shortfall is paid for
       by the invisible extension — losing this silently makes every button on a
       phone harder to hit without changing a single pixel on screen. */
    expect(c).toContain('tap-target');
    expect(c).toContain('disabled:opacity-45');
  });

  it('keeps radius 8 on an icon button, where §6.2 wants it', () => {
    const c = classesOf(<Button size="icon" aria-label={LABEL} />);

    expect(c).toContain('rounded-lg');
    expect(c).not.toContain('rounded-xl');
    expect(c).toContain('tap-target');
  });

  it('gives the outline variant a control border and a plain hover fill', () => {
    const c = classesOf(<Button variant="outline">{LABEL}</Button>);

    /* `control`, not `btn-line`: the boundary of an interactive control must
       hold 3:1 (WCAG 2.2 SC 1.4.11, canon §1.6). btn-line measures 1.45:1 on
       the card and stays for dividers only — decided and merged in #315; the
       owner's words for the old border were «совсем не видна». */
    expect(c).toContain('border-border-control');
    expect(c).not.toContain('border-border-medium');
    expect(c).toContain('hover:bg-surface-hover');
    /* Upstream's shadcn hover recoloured the label too; the canon does not. */
    expect(c).not.toContain('hover:text-accent-foreground');
    expect(c).not.toContain('hover:bg-accent');
  });

  it('lets a call site win, because the sign-in card is 40 by canon', () => {
    const c = classesOf(<Button className="h-12 sm:h-10">{LABEL}</Button>);

    expect(c).toContain('h-12');
    expect(c).not.toContain('h-9');
  });
});

describe('the canon a field carries', () => {
  it('is 36 on a desktop, 48 on a phone, radius 12, on a card fill', () => {
    const c = FIELD_BASE.split(/\s+/);

    expect(c).toContain('h-12');
    expect(c).toContain('md:h-9');
    expect(c).toContain('rounded-xl');
    expect(c).toContain('bg-surface-primary');
    expect(c).toContain('disabled:opacity-45');
  });

  it('leaves the border to FIELD_BORDER, so an error can replace just that', () => {
    expect(FIELD_BASE).not.toMatch(/\bborder-border-/);
    /* §6.4 ред. 11.08-3: покой — волосяная линия + тень sm (владелец снял
       рамку `control` со всех полей: «чёрная полоса»); контраст ≥3:1 несёт
       ФОКУС — потемнение рамки до чернил, которое обязано остаться. */
    expect(FIELD_BORDER).toContain('border-border-light');
    expect(FIELD_BORDER).toContain('shadow-sm');
    expect(FIELD_BORDER).not.toContain('border-border-control');
    expect(FIELD_BORDER).toContain('focus-visible:border-border-focus');
    expect(FIELD_BORDER).toContain('focus-visible:ring-ring-primary-soft');
  });
});

/* §6.3/§1.1 ред. 11.08-4 (владелец, референс Perplexity): включённый чип и
 * активный сегмент — КАРТОЧКА (card + hairline, рецепт «Нового чата»);
 * пассив — заливка без рамки, hover темнеет до `active`. Серый тинт актива
 * из 11.08-3 читался наоборот — как выключенное состояние. */
describe('the canon a tool chip carries', () => {
  it('draws the enabled chip as a card', () => {
    expect(CHIP_CHECKED).toContain('bg-surface-primary');
    expect(CHIP_CHECKED).toContain('border-border-light');
    expect(CHIP_CHECKED).not.toContain('bg-surface-active');
  });

  it('draws the passive chip as a plain fill that darkens under the cursor', () => {
    expect(CHIP_BASE).toContain('bg-surface-primary-alt');
    expect(CHIP_BASE).toContain('border-transparent');
    expect(CHIP_BASE).not.toContain('shadow');
    expect(CHIP_BASE).toContain('hover:bg-surface-active');
  });
});
