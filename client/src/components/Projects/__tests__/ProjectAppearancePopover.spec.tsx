import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import type { ReactNode } from 'react';
import { PROJECT_COLORS, PROJECT_ICONS } from '../iconOptions';
import ProjectAppearancePopover from '../ProjectAppearancePopover';
import en from '~/locales/en/translation.json';
import ru from '~/locales/ru/translation.json';

/**
 * The swatches and icon tiles are pure graphics, so their accessible name is the
 * only thing a screen-reader user gets. They used to expose the raw palette key
 * ("black", "FlaskConical") — English identifiers announced in the middle of a
 * Russian interface, and "black" was wrong on top of that once the palette moved
 * to a mid-tone slate.
 */

function renderPicker() {
  const wrapper = ({ children }: { children: ReactNode }) => <RecoilRoot>{children}</RecoilRoot>;
  return render(
    <ProjectAppearancePopover
      open
      onOpenChange={jest.fn()}
      value={{ icon: 'Folder', color: 'black' }}
      onChange={jest.fn()}
    />,
    { wrapper },
  );
}

describe('project appearance picker — accessible names', () => {
  it('names every button with its translated label, not its palette key', () => {
    renderPicker();
    for (const { name } of PROJECT_COLORS) {
      const label = en[`com_projects_color_${name}` as keyof typeof en];
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    for (const { name } of PROJECT_ICONS) {
      const label = en[`com_projects_icon_${name}` as keyof typeof en];
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('reads the label through i18n rather than echoing the key', () => {
    renderPicker();
    // Keys whose label differs from the key itself: if the lookup were dropped,
    // the button would be named "FlaskConical" and these would fail. A few icons
    // (Palette, Folder) translate to their own key in English, so they cannot
    // tell the two apart — these can.
    expect(screen.getByRole('button', { name: 'Lab flask' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Money' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'FlaskConical' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DollarSign' })).not.toBeInTheDocument();
    // "black" was both a raw key and a lie after the palette moved to slate.
    expect(screen.queryByRole('button', { name: 'black' })).not.toBeInTheDocument();
  });

  it('has a label for every colour and icon, in both languages', () => {
    const missing: string[] = [];
    for (const { name } of PROJECT_COLORS) {
      const key = `com_projects_color_${name}`;
      if (!(key in en)) missing.push(`en:${key}`);
      if (!(key in ru)) missing.push(`ru:${key}`);
    }
    for (const { name } of PROJECT_ICONS) {
      const key = `com_projects_icon_${name}`;
      if (!(key in en)) missing.push(`en:${key}`);
      if (!(key in ru)) missing.push(`ru:${key}`);
    }
    // Fails the moment someone adds a swatch or an icon without a label.
    expect(missing).toEqual([]);
  });
});
