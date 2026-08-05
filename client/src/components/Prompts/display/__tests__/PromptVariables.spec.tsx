import { render, screen } from '@testing-library/react';
import PromptVariables from '../PromptVariables';

/**
 * The variables panel of a saved prompt. Three kinds are read out of the prompt
 * text and shown differently, and getting them mixed up is what a user notices:
 * a choice they were meant to pick from would arrive as a blank field instead.
 *
 * Only `useLocalize` is stubbed, and it reads the real English file, so a
 * renamed or deleted key still fails.
 */
jest.mock('~/hooks', () => {
  const english = jest.requireActual('~/locales/en/translation.json');
  return {
    useLocalize: () => (key: string, vars?: Record<string, string | number>) =>
      Object.entries(vars ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        english[key] ?? key,
      ),
  };
});

describe('prompt variables', () => {
  it('shows nothing at all when the prompt has no variables', () => {
    const { container } = render(<PromptVariables promptText="Просто текст без переменных." />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reads a plain variable as a field to fill in', () => {
    render(<PromptVariables promptText="Напиши письмо для {{контрагент}}." />);

    expect(screen.getByText('Text variables')).toBeInTheDocument();
    expect(screen.getByText('контрагент')).toBeInTheDocument();
    expect(screen.queryByText('Dropdown variables:')).not.toBeInTheDocument();
  });

  it('reads a variable with alternatives as a choice, listing every option', () => {
    render(<PromptVariables promptText="Тон: {{тон:деловой|дружеский|краткий}}" />);

    expect(screen.getByText('Dropdown variables:')).toBeInTheDocument();
    expect(screen.getByText('тон')).toBeInTheDocument();
    for (const option of ['деловой', 'дружеский', 'краткий']) {
      expect(screen.getByText(option)).toBeInTheDocument();
    }
    /* Listed as a choice and nowhere else — a variable in both sections would
     * ask the user to fill it in twice. */
    expect(screen.queryByText('Text variables')).not.toBeInTheDocument();
  });

  it('treats a lone alternative as a plain field, not a choice of one', () => {
    /* A single alternative is not a choice, so it stays a plain field. */
    render(<PromptVariables promptText="Тон: {{тон:деловой}}" />);

    expect(screen.getByText('Text variables')).toBeInTheDocument();
    expect(screen.queryByText('Dropdown variables:')).not.toBeInTheDocument();
  });

  it('recognises the variables the platform fills in by itself', () => {
    render(<PromptVariables promptText="Сегодня {{current_date}}, пишет {{current_user}}." />);

    expect(screen.getByText('Special variables')).toBeInTheDocument();
    expect(screen.queryByText('Text variables')).not.toBeInTheDocument();
  });

  it('counts every distinct variable once, whatever their kind', () => {
    render(
      <PromptVariables promptText="{{current_date}} {{контрагент}} {{тон:а|б}} {{контрагент}}" />,
    );

    expect(screen.getByText('Variables')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
