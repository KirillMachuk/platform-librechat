import { pptxArtifactReportFixture } from './__fixtures__/pptxArtifactReport';
import { artifactJobSchema, artifactReportSchema } from './artifactReport';

describe('artifactReportSchema', () => {
  it('accepts the PPTX fixture and preserves unknown optional fields', () => {
    const parsed = artifactReportSchema.parse(pptxArtifactReportFixture);

    expect(parsed.status).toBe('ready');
    expect(parsed.previewAssets[0].pageCount).toBe(8);
    expect(parsed.reviewHints).toEqual({ sourcePanel: true });
  });

  it('rejects repair counts beyond the automatic repair limit', () => {
    expect(() =>
      artifactReportSchema.parse({ ...pptxArtifactReportFixture, repairIterations: 3 }),
    ).toThrow();
  });
});

describe('artifactJobSchema', () => {
  it('accepts an LLM-agnostic Russian PPTX authoring job', () => {
    expect(
      artifactJobSchema.parse({
        format: 'pptx',
        audience: 'Совет директоров',
        goal: 'Утвердить план роста',
        sourceFileIds: ['financial-model.xlsx'],
        immutableElements: ['Фактические значения'],
        locale: 'ru-RU',
        filename: 'plan-rosta-2027.pptx',
        acceptanceCriteria: ['Все фактологические слайды имеют источник'],
      }),
    ).toMatchObject({ format: 'pptx', locale: 'ru-RU' });
  });

  it('rejects a filename that does not match the requested format', () => {
    expect(() =>
      artifactJobSchema.parse({
        format: 'pptx',
        audience: 'Совет директоров',
        goal: 'Утвердить план роста',
        sourceFileIds: [],
        immutableElements: [],
        locale: 'ru-RU',
        filename: 'plan-rosta-2027.md',
        acceptanceCriteria: ['Файл открывается в PowerPoint'],
      }),
    ).toThrow('Filename must end in .pptx');
  });
});
