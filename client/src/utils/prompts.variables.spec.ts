import { extractUniqueVariables, extractVariableInfo } from './prompts';

describe('prompt variable extraction (C-PRM-3)', () => {
  it('extracts unique variables from normal templates', () => {
    expect(extractUniqueVariables('Hi {{name}}, you are {{role}} and {{name}}')).toEqual([
      'name',
      'role',
    ]);
  });

  it('extractVariableInfo reports uniques and repeats', () => {
    const info = extractVariableInfo('{{a}} {{b}} {{a}}');
    expect(info.uniqueVariables).toEqual(['a', 'b']);
    expect(Array.from(info.repeatedVariables)).toEqual(['a']);
  });

  it('does not hang on a pathological unclosed-brace input (ReDoS guard)', () => {
    const evil = '{{'.repeat(50000) + 'x';
    const start = Date.now();
    const vars = extractUniqueVariables(evil);
    const elapsed = Date.now() - start;
    expect(vars).toEqual([]);
    expect(elapsed).toBeLessThan(200);
  });

  it('ignores nested braces rather than capturing across them', () => {
    // `[^{}]*` stops the capture at an inner brace, so only the clean pair matches.
    expect(extractUniqueVariables('{{outer {{inner}} }}')).toEqual(['inner']);
  });
});
