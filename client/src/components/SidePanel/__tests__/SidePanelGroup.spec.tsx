import { RecoilRoot, useRecoilValue } from 'recoil';
import { render, screen } from '@testing-library/react';
import SidePanelGroup from '../SidePanelGroup';
import store from '~/store';

/**
 * Canon §4 and §6.15: with the artifacts panel open the working area and the
 * panel are TWO cards with a gap between them, not one surface with a rule down
 * the middle. Both cards are dressed identically — radius 16, hairline, `bg`
 * fill, `shadow-sm` — and every layer between the canvas and the gap stops
 * painting so the canvas shows through.
 *
 * This exists because that layout was reverted byte for byte two commits after
 * it landed (#265 undone by #267, a branch cut from a stale base) and nothing
 * failed. The claims below are read off the class string the browser receives,
 * never off the source: `cn` is `twMerge`, which silently drops whichever of
 * two conflicting utilities it decides lost.
 *
 * The 8px of the gap itself, and the fact that the handle paints nothing, are
 * owned by `packages/client/src/components/Resizable.spec.tsx` — `client`
 * imports that package as its built bundle, so a guard here would be reading
 * `dist` rather than the source.
 */
const CHAT = 'chat-content';
const ARTIFACTS = 'artifacts-content';
const FRAME = 'frame-split';

/** Canon numbers, not taste: radius 16, hairline border, `bg` fill, one shadow. */
const CARD = [
  'h-full',
  'overflow-hidden',
  'rounded-2xl',
  'border',
  'border-border-light',
  'bg-presentation',
  'shadow-sm',
];

const classesOf = (element: Element): string[] => element.className.split(/\s+/).filter(Boolean);

/** Reads the flag the layers above the group act on. */
const FrameProbe = () => (
  <span data-testid={FRAME}>{String(useRecoilValue(store.artifactsFrameSplit))}</span>
);

const renderSplit = () =>
  render(
    <RecoilRoot>
      <FrameProbe />
      <SidePanelGroup artifacts={<div data-testid={ARTIFACTS} />}>
        <div data-testid={CHAT} />
      </SidePanelGroup>
    </RecoilRoot>,
  );

describe('the frame around an open artifacts panel', () => {
  it('dresses the chat and the panel as two identical cards', () => {
    renderSplit();

    const chatCard = classesOf(screen.getByTestId(CHAT).parentElement as Element);
    const panelCard = classesOf(screen.getByTestId(ARTIFACTS).parentElement as Element);

    for (const token of CARD) {
      expect(chatCard).toContain(token);
      expect(panelCard).toContain(token);
    }
  });

  it('stops painting the layer behind them, so the gap shows canvas', () => {
    const { container } = renderSplit();
    const group = classesOf(container.querySelector('[data-panel]')?.parentElement as Element);

    /* A fill here reaches edge to edge under both cards, and the 8px between
       them stops reading as canvas — the two cards collapse back into one
       surface separated by nothing but two hairlines. */
    expect(group).toContain('bg-transparent');
    expect(group).not.toContain('bg-presentation');
    /* And it still covers the box it stopped painting, which is what lets the
       layer above stop painting too. */
    expect(group).toContain('h-full');
    expect(group).toContain('w-full');
    expect(group).toContain('flex-1');
  });

  it('tells the layers above it, for exactly as long as the split is mounted', () => {
    const { rerender } = renderSplit();

    expect(screen.getByTestId(FRAME)).toHaveTextContent('true');

    /* The frame that acts on this wraps EVERY route, while the artifact state
       behind it is global and outlives the chat. Derived from that state, an
       artifact left open would strip the card off Prompts, Agents and the rest;
       published by the split itself, it dies with the chat. */
    rerender(
      <RecoilRoot>
        <FrameProbe />
      </RecoilRoot>,
    );

    expect(screen.getByTestId(FRAME)).toHaveTextContent('false');
  });
});

describe('the frame with no artifacts panel', () => {
  it('leaves one card, wraps nothing, and claims no split', () => {
    const { container } = render(
      <RecoilRoot>
        <FrameProbe />
        <SidePanelGroup>
          <div data-testid={CHAT} />
        </SidePanelGroup>
      </RecoilRoot>,
    );

    /* One card is the frame's own, drawn by `Root`. A second one here would
       ring the conversation inside it. */
    expect(classesOf(screen.getByTestId(CHAT).parentElement as Element)).not.toContain(
      'rounded-2xl',
    );
    expect(classesOf(container.querySelector('[data-panel]')?.parentElement as Element)).toContain(
      'bg-presentation',
    );
    expect(screen.getByTestId(FRAME)).toHaveTextContent('false');
  });
});
