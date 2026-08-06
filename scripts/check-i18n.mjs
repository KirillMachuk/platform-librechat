/**
 * Guards the interface strings: every key the UI asks for must exist, the
 * Russian file must not fall behind English, and no component hands the screen
 * reader an English literal.
 *
 * The client is Russian-only in production, so a key that exists in neither
 * file is not a cosmetic gap — the person sees `com_ui_search_table` where a
 * label should be. Twelve keys were in exactly that state when this was
 * written, some of them on an error screen.
 *
 * Run with `npm run check:i18n`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EN = 'client/src/locales/en/translation.json';
const RU = 'client/src/locales/ru/translation.json';
const SRC = ['client/src', 'packages/client/src'];
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '__tests__', '__mocks__', 'locales']);
const CODE = /\.(ts|tsx|js|jsx)$/;
const IS_TEST = /\.(spec|test)\./;

/**
 * Keys the code builds at runtime from a prefix, so no literal for the whole
 * key exists anywhere. Each entry must say who builds it — an unexplained
 * entry is how a real missing key gets hidden.
 */
const RUNTIME_PREFIXES = {
  com_error: 'client/src/components/Messages/Content/Error.tsx builds com_error_<type>',
};

const problems = [];

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) {
        yield* sources(path);
      }
    } else if (entry.isFile() && CODE.test(entry.name) && !IS_TEST.test(entry.name)) {
      yield path;
    }
  }
}

const en = JSON.parse(readFileSync(join(ROOT, EN), 'utf8'));
const ru = JSON.parse(readFileSync(join(ROOT, RU), 'utf8'));

const used = new Map();
const LITERAL = /['"`](com_[a-z0-9_]+)['"`]/g;
for (const root of SRC) {
  for (const path of sources(join(ROOT, root))) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(LITERAL)) {
      const key = match[1];
      if (!used.has(key)) {
        used.set(key, `${relative(ROOT, path).split(sep).join('/')}:${text.slice(0, match.index).split('\n').length}`);
      }
    }
  }
}

for (const [key, where] of used) {
  if (key in en || key in RUNTIME_PREFIXES) {
    continue;
  }
  problems.push(
    `${where}\n    the UI asks for "${key}", which no translation file has\n` +
      '    → add it to both locale files; without it the person reads the key itself',
  );
}

for (const key of Object.keys(en)) {
  if (!(key in ru)) {
    problems.push(
      `${RU}\n    "${key}" is missing — Russian falls back to «${en[key]}»\n` +
        '    → translate it; production runs in Russian only',
    );
  }
}

/**
 * No component hands the screen reader an English literal.
 *
 * Visible text is caught by eye and by the lint rule; an `aria-label` is not —
 * it is invisible, so twelve of them sat in the app announcing "Dismiss banner"
 * and "Archived chats" to a Russian listener, and one e2e locator had come to
 * depend on one staying broken.
 *
 * Only word-shaped literals count: a symbol or a digit as a label is a
 * different problem and not this one's business.
 */
const WORDY_LABEL = /aria-label\s*=\s*"([^"{}]*[A-Za-z]{2,}[^"{}]*)"/g;

for (const file of SRC.flatMap((dir) => [...sources(join(ROOT, dir))])) {
  const text = readFileSync(file, 'utf8');
  for (const [, label] of text.matchAll(WORDY_LABEL)) {
    problems.push(
      `${relative(ROOT, file).split(sep).join('/')}\n` +
        `    the screen reader is handed the English literal "${label}"\n` +
        `    → localize() it, or drop it when the visible text already names the control`,
    );
  }
}

for (const [prefix, why] of Object.entries(RUNTIME_PREFIXES)) {
  const built = Object.keys(en).some((k) => k.startsWith(`${prefix}_`));
  if (!built) {
    problems.push(
      `${EN}\n    nothing starts with "${prefix}_", so the runtime-prefix exemption is stale\n` +
        `    → drop it from RUNTIME_PREFIXES in this script (it was there because ${why})`,
    );
  }
}

if (problems.length) {
  console.error(`\ninterface strings: ${problems.length} problem(s)\n`);
  for (const problem of problems) {
    console.error(`  ${problem}\n`);
  }
  process.exit(1);
}

console.log(
  `interface strings hold: ${used.size} keys asked for, ${Object.keys(en).length} in English, ${Object.keys(ru).length} in Russian, none missing`,
);
