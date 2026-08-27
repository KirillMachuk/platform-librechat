import { parseConvo, parseCompactConvo } from './parsers';
import { EModelEndpoint } from './schemas';

/**
 * A preset arrives as an arbitrary user-chosen JSON file, so its `endpoint` is an
 * arbitrary string — including the names every JS object inherits. `schemas[name]`
 * answers for those, so the "unknown endpoint" guard used to pass and the next line
 * died on `schema.parse is not a function`. That call sits inside a FileReader
 * callback (`usePresets.onFileSelected`), where a TypeError is not even a rejected
 * promise — just a dead Import button, the exact failure the export work set out to end.
 */
describe('inherited object keys are not endpoint schemas', () => {
  /* The type says `EModelEndpoint`; a preset FILE says whatever it likes. The cast is
   * the point of the test — it reproduces the value that actually arrives at runtime. */
  const inherited = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'].map(
    (name) => name as EModelEndpoint,
  );

  it.each(inherited)('parseConvo refuses %s by name, not by TypeError', (endpoint) => {
    expect(() => parseConvo({ endpoint, conversation: {} })).toThrow(
      `Unknown endpoint: ${endpoint}`,
    );
  });

  it.each(inherited)('parseCompactConvo refuses %s by name, not by TypeError', (endpoint) => {
    expect(() => parseCompactConvo({ endpoint, conversation: {} })).toThrow(
      `Unknown endpoint: ${endpoint}`,
    );
  });

  it('still parses a real endpoint', () => {
    expect(() => parseConvo({ endpoint: EModelEndpoint.openAI, conversation: {} })).not.toThrow();
  });
});
