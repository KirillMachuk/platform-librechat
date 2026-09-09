const fs = require('fs');
const path = require('path');

/**
 * A structural guard, on purpose.
 *
 * Three attempts at one fix shipped in a single day, each with a green suite, because
 * the tests pinned the DECISION while the defect lived at the CALL SITE: the success
 * path threw the generated title away together with skipping the final emit, and
 * mutating that call site back to the two-liner left every unit test passing. The
 * neighbouring `jobReplacement.spec.js` cannot catch it either — it re-implements the
 * branch it is describing rather than running it, so it stays green whatever the
 * controller does.
 *
 * Running the real controller here would mean standing up the agent client, the job
 * manager, the model and the database, which is a bigger construction than the code it
 * would protect. The invariant is structural, so the guard is too: exactly one function
 * may throw a generated title away, and it makes that decision with the predicate that
 * treats an absent job as «this run ended», not as «someone else owns this now».
 */
describe('only settleTitleForEndedJob may discard a generated title', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'request.js'), 'utf8');

  /** Body of a top-level `function name(...) {...}`, matched by brace depth.
   *  The parameter list is skipped first: a destructured signature opens braces of its
   *  own, and counting from the first one returns the signature instead of the body —
   *  which is how the first draft of this guard passed on code it should have failed. */
  const functionBody = (name) => {
    const start = source.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    let parens = 0;
    let afterParams = -1;
    for (let i = source.indexOf('(', start); i < source.length; i++) {
      if (source[i] === '(') parens++;
      else if (source[i] === ')' && --parens === 0) {
        afterParams = i;
        break;
      }
    }
    expect(afterParams).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = source.indexOf('{', afterParams); i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) return source.slice(afterParams, i + 1);
    }
    throw new Error(`unbalanced braces in ${name}`);
  };

  it('names exactly one place that aborts the discard controller', () => {
    const calls = source.match(/titleDiscardController\.abort\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(functionBody('settleTitleForEndedJob')).toContain('titleDiscardController.abort()');
  });

  it('gates that abort on supersession, never on the job merely being gone', () => {
    const body = functionBody('settleTitleForEndedJob');
    expect(body).toContain('isSupersededByNewerJob(');
    expect(body).not.toContain('shouldSkipFinalEmit(');
  });

  it('keeps the two questions apart: absence ends a run, it does not replace one', () => {
    expect(functionBody('isSupersededByNewerJob')).toMatch(/currentJob\s*!=\s*null/);
    expect(functionBody('shouldSkipFinalEmit')).toMatch(/currentJob\s*==\s*null/);
  });

  it('cancels generation on the failure path even if the job lookup throws', () => {
    /* The comment there promises a failed turn stops paying for a title. Inside the
     * try that promise is only kept while Redis answers. */
    const catchBlock = source.slice(
      source.indexOf('} catch (error) {', source.indexOf('emitDone')),
    );
    const abortAt = catchBlock.indexOf('titleAbortController.abort()');
    const tryAt = catchBlock.indexOf('const currentJob = await GenerationJobManager.getJob');
    expect(abortAt).toBeGreaterThan(-1);
    expect(tryAt).toBeGreaterThan(-1);
    expect(abortAt).toBeLessThan(tryAt);
  });
});
