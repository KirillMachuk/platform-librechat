import type { TMessage } from 'librechat-data-provider';
import { resolveDrReport, extractReportTitle } from '../report';

const REPORT = '# Рынок CRM в СНГ\n\nНа рынке СНГ...\n\n## Игроки\n...';

const msg = (over: Partial<TMessage>): TMessage =>
  ({ isCreatedByUser: false, text: '', ...over }) as unknown as TMessage;

describe('extractReportTitle', () => {
  it('takes the first H1/H2 and strips markdown', () => {
    expect(extractReportTitle('# **Рынок** CRM\n\nтекст')).toBe('Рынок CRM');
    expect(extractReportTitle('## Итоги\nтекст')).toBe('Итоги');
  });
  it('returns null when there is no heading', () => {
    expect(extractReportTitle('просто текст без заголовка')).toBeNull();
    expect(extractReportTitle('')).toBeNull();
  });
});

describe('resolveDrReport (review r2: keyed on the persisted drKind provenance)', () => {
  it('detects a runner-stamped report and extracts its title', () => {
    expect(resolveDrReport(msg({ drKind: 'report', text: REPORT }))).toEqual({
      title: 'Рынок CRM в СНГ',
    });
  });

  it('falls back to an empty title when the report has no lead heading', () => {
    expect(
      resolveDrReport(msg({ drKind: 'report', text: 'Отчёт без заголовка. Данные...' })),
    ).toEqual({ title: '' });
  });

  it('does NOT treat prose that merely looks like a report as one (no drKind)', () => {
    expect(resolveDrReport(msg({ text: REPORT }))).toBeNull();
  });

  it('ignores other drKind values and user messages', () => {
    expect(resolveDrReport(msg({ drKind: 'plan', text: REPORT }))).toBeNull();
    expect(resolveDrReport(msg({ drKind: 'clarify', text: REPORT }))).toBeNull();
    expect(
      resolveDrReport(msg({ drKind: 'report', isCreatedByUser: true, text: REPORT })),
    ).toBeNull();
  });

  it('returns null for empty text even when stamped', () => {
    expect(resolveDrReport(msg({ drKind: 'report', text: '   ' }))).toBeNull();
  });
});
