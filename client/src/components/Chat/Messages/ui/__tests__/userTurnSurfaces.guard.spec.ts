import { join } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';

/**
 * Every surface that draws the user's own turn must also carry the chip rules.
 *
 * This exact omission has now happened four times: the ask_user answers chip and the
 * Deep Research command chip were each mounted on ONE renderer and were dead on the one
 * users actually reach, and the share view had neither. Each was found by a person, not
 * by a test, and each shipped in between. A comment asking the next author to remember
 * is what we had; this is a guard instead.
 *
 * It reads sources rather than rendering, on purpose — it is checking WIRING, and the
 * cheapest honest way to prove a surface is wired is that it imports the rules. It fails
 * loudly for a new surface: either mount both hooks, or add the file to EXEMPT with a
 * reason a reviewer can weigh.
 */
const CLIENT_SRC = join(__dirname, '../../../../..');
const BUBBLE = 'USER_BUBBLE_CLASS';
const HOOKS = ['useDrActionChip', 'useAskUserChip'];

/** Surfaces that draw the bubble but deliberately carry no chips. */
const EXEMPT = new Map<string, string>([
  [
    'components/Chat/Messages/MessageParts.tsx',
    'Reachable only for the `assistants` endpoint (MultiMessage gates on ' +
      'isAssistantsEndpoint), where neither Deep Research nor ask_user runs.',
  ],
  ['components/Chat/Messages/ui/turn.ts', 'Defines the class; draws nothing.'],
  [
    'components/Chat/Messages/DeepResearch/AnswersChip.tsx',
    'IS a chip: it names the class in a comment to explain matching its width ceiling.',
  ],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') {
        walk(full, out);
      }
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.(spec|test)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('every user-turn surface carries the chip rules', () => {
  const surfaces = walk(join(CLIENT_SRC, 'components'))
    .filter((file) => readFileSync(file, 'utf8').includes(BUBBLE))
    .map((file) => file.slice(CLIENT_SRC.length + 1));

  it('finds the surfaces at all (a matcher that matches nothing guards nothing)', () => {
    expect(surfaces.length).toBeGreaterThanOrEqual(4);
    expect(surfaces).toContain('components/Chat/Messages/ui/MessageRender.tsx');
  });

  it.each(surfaces)('%s mounts both chip rules, or is exempt with a reason', (surface) => {
    if (EXEMPT.has(surface)) {
      expect(EXEMPT.get(surface)).toBeTruthy();
      return;
    }
    const source = readFileSync(join(CLIENT_SRC, surface), 'utf8');
    for (const hook of HOOKS) {
      /* A CALL, not a substring: `expect(source).toContain(hook)` also accepts
       * `useDrActionChipX`, so a rename would have slipped straight past. */
      expect(source).toMatch(new RegExp(`\\b${hook}\\s*\\(`));
    }
  });

  it('the matcher rejects a renamed hook (it must not match by substring)', () => {
    const renamed = `const chip = ${HOOKS[0]}X(msg);`;
    expect(renamed).not.toMatch(new RegExp(`\\b${HOOKS[0]}\\s*\\(`));
    expect(`const chip = ${HOOKS[0]}(msg);`).toMatch(new RegExp(`\\b${HOOKS[0]}\\s*\\(`));
  });

  it('lists no exemption for a file that no longer exists', () => {
    for (const exempt of EXEMPT.keys()) {
      expect(() => statSync(join(CLIENT_SRC, exempt))).not.toThrow();
    }
  });
});
