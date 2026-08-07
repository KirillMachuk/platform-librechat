import React from 'react';
import { render, screen } from '@testing-library/react';
import { SettingRow, SettingGroup } from './SettingRow';
import { Switch } from './Switch';

/**
 * These assert on the className the component actually resolves to, not on the
 * source: `cn` is `twMerge`, and it silently drops whichever of two conflicting
 * utilities it decides loses. Reading the JSX tells you nothing about the
 * winner. Nothing here is mocked for the same reason.
 */
describe('SettingRow — canon §6.4', () => {
  /* Title → text column → row. The first version stopped one level short and
     asserted the row's geometry against the text column, which of course has
     none of it. */
  const row = () => screen.getByText('Отправлять по Enter').parentElement!.parentElement!;

  it('shows the explanation as text on screen, not as something to hover', () => {
    render(
      <SettingRow
        id="enterToSend"
        title="Отправлять по Enter"
        description="перенос строки — Shift+Enter"
      />,
    );

    expect(screen.getByText('перенос строки — Shift+Enter')).toBeVisible();
  });

  it('puts the explanation under the title, in t3 at 12.5', () => {
    render(
      <SettingRow id="enterToSend" title="Отправлять по Enter" description="перенос строки" />,
    );

    const description = screen.getByText('перенос строки');
    expect(description.className).toContain('text-[12.5px]');
    expect(description.className).toContain('text-text-tertiary');
    expect(description.id).toBe('enterToSend-description');
  });

  it('keeps the row 48 high on a desktop and 56 on a phone, with a hairline above it', () => {
    render(<SettingRow id="enterToSend" title="Отправлять по Enter" />);

    const className = row().className;
    expect(className).toContain('min-h-14');
    expect(className).toContain('md:min-h-12');
    expect(className).toContain('border-t');
    expect(className).toContain('first:border-t-0');
  });

  it('hands the control the ids of text that is really on screen', () => {
    render(
      <SettingRow
        id="enterToSend"
        title="Отправлять по Enter"
        description="перенос строки"
        control={({ labelId, descriptionId }) => (
          <Switch
            size="row"
            checked
            onCheckedChange={jest.fn()}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            data-testid="sw"
          />
        )}
      />,
    );

    const control = screen.getByTestId('sw');
    expect(control.getAttribute('aria-labelledby')).toBe('enterToSend-label');
    expect(control.getAttribute('aria-describedby')).toBe('enterToSend-description');
    expect(screen.getByText('Отправлять по Enter').id).toBe('enterToSend-label');
  });

  it('leaves no description id behind when there is no description', () => {
    render(
      <SettingRow
        id="autoScroll"
        title="Прокрутка"
        control={({ descriptionId }) => (
          <Switch
            size="row"
            checked
            onCheckedChange={jest.fn()}
            aria-label="Прокрутка"
            aria-describedby={descriptionId}
            data-testid="sw"
          />
        )}
      />,
    );

    expect(screen.getByTestId('sw').hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('SettingGroup — canon §6.4', () => {
  it('draws the card the rows sit in', () => {
    const { container } = render(
      <SettingGroup>
        <SettingRow id="a" title="Первая" />
        <SettingRow id="b" title="Вторая" />
      </SettingGroup>,
    );

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('rounded-xl');
    expect(card.className).toContain('border-border-light');
    expect(card.className).toContain('overflow-hidden');
    expect(card.children).toHaveLength(2);
  });
});

describe('Switch — canon §6.4', () => {
  it('is 36×20 in a setting row on a desktop and stays finger-sized on a phone', () => {
    render(<Switch size="row" checked onCheckedChange={jest.fn()} aria-label="x" />);

    const className = screen.getByRole('switch').className;
    expect(className).toContain('h-[27px]');
    expect(className).toContain('w-[46px]');
    expect(className).toContain('md:h-5');
    expect(className).toContain('md:w-9');
  });

  it('fills with the accent when on, not with ink', () => {
    render(<Switch checked onCheckedChange={jest.fn()} aria-label="x" />);

    const className = screen.getByRole('switch').className;
    expect(className).toContain('data-[state=checked]:bg-brand-purple');
    expect(className).not.toContain('bg-primary');
  });
});
