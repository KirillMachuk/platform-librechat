import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, unknown>) =>
    `${key}:${params?.[0] ?? ''}`,
}));

import SkillPills from '../SkillPills';

describe('SkillPills', () => {
  it('renders nothing when skills is undefined', () => {
    const { container } = render(<SkillPills />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when skills is empty', () => {
    const { container } = render(<SkillPills skills={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one pill per entry', () => {
    render(<SkillPills skills={['brand-guidelines', 'pptx']} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('brand-guidelines');
    expect(items[1]).toHaveTextContent('pptx');
  });

  it('localizes the list aria-label (manual default)', () => {
    render(<SkillPills skills={['pptx']} />);
    expect(screen.getByRole('list')).toHaveAttribute('aria-label', 'com_ui_skills_manual_invoked:');
  });

  it('tags each pill with data-skill-source="manual" by default', () => {
    render(<SkillPills skills={['brand']} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-skill-source', 'manual');
  });

  it('switches aria-label and data attribute for source="always-apply"', () => {
    render(<SkillPills skills={['legal']} source="always-apply" />);
    expect(screen.getByRole('list')).toHaveAttribute(
      'aria-label',
      'com_ui_skills_always_apply_invoked:',
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-skill-source', 'always-apply');
  });

  it('renders the pin-icon variant for always-apply (no ScrollText)', () => {
    const { container: alwaysApply } = render(
      <SkillPills skills={['legal']} source="always-apply" />,
    );
    const { container: manual } = render(<SkillPills skills={['brand']} />);
    /* Phosphor icons carry no identifying class the way lucide did, so the
       contract is asserted on what the user actually gets: the two variants
       draw DIFFERENT pictures. Geometry inequality survives icon-set swaps;
       a class-name assertion did not survive this one. */
    const alwaysApplySvg = alwaysApply.querySelector('svg');
    const manualSvg = manual.querySelector('svg');
    expect(alwaysApplySvg).toBeTruthy();
    expect(manualSvg).toBeTruthy();
    expect(alwaysApplySvg?.innerHTML).not.toBe(manualSvg?.innerHTML);
  });
});
