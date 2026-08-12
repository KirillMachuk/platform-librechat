import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { ThinkingContent, ThinkingButton } from '../Thinking';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useExpandCollapse: () => ({
    isExpanded: true,
    toggle: jest.fn(),
    expandStyle: {},
    expandRef: { current: null },
  }),
}));

/**
 * The reasoning block sits one step BELOW the conversation (13px when
 * messages are 15px), derived from --markdown-font-size via the
 * --thinking-font-size variable in style.css. Before this contract existed
 * the block wore the raw fontSizeAtom class — text-base, 16px — and rendered
 * LARGER than the answer it explains. jsdom cannot compute the calc(), so
 * this test pins the CLASS contract; the CSS math is measured in the live
 * probe (typo_probe.js) against the built bundle.
 */
describe('reasoning block typography (canon: one step below the conversation)', () => {
  it('ThinkingContent sizes via --thinking-font-size, not the raw font-size atom', () => {
    const thought = 'мысль';
    render(
      <RecoilRoot>
        <ThinkingContent>{thought}</ThinkingContent>
      </RecoilRoot>,
    );
    const p = screen.getByText(thought);
    expect(p.className).toContain('text-[length:var(--thinking-font-size)]');
    expect(p.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });

  it('ThinkingButton header wears the same derived size', () => {
    render(
      <RecoilRoot>
        <ThinkingButton isExpanded={false} onClick={jest.fn()} label="Мысли" contentId="think-1" />
      </RecoilRoot>,
    );
    const button = screen.getByRole('button', { name: /Мысли/ });
    expect(button.className).toContain('text-[length:var(--thinking-font-size)]');
    expect(button.className).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });
});
