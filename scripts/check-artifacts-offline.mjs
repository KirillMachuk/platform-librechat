/**
 * Guards the artifact preview against phoning a third party.
 *
 * An artifact preview renders the client's own material — an HTML answer, a
 * markdown plan, and every DOCX / XLSX / PPTX preview goes through the same
 * `static` bucket. Measured on the stand before this was fixed, opening ONE
 * artifact made seven requests to `*.sandpack-static-server.codesandbox.io`
 * plus a Cloudflare RUM beacon, with the document rendered inside that third
 * party's frame. The static path now renders in our own sandboxed iframe and
 * the Tailwind runtime is vendored at `client/public/assets/`.
 *
 * Run with `npm run check:artifacts-offline`.
 *
 * This guard fails when:
 *   1. artifact code names an external CDN/bundler host in a URL position —
 *      the way the CDN got in the first time;
 *   2. the vendored Tailwind file is missing (a broken preview otherwise
 *      looks like a styling bug, not a missing asset);
 *   3. the sandboxed iframe gains `allow-same-origin`, which together with
 *      `allow-scripts` lets an artifact take its own sandbox off and read the
 *      session it was supposed to be isolated from.
 *
 * It deliberately does NOT ban the strings in prose: comments and tests must
 * be able to name what they replaced. Only URL positions count.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = ['client/src/utils/artifacts.ts', 'client/src/components/Artifacts'];
const TAILWIND = 'client/public/assets/tailwind-3.4.17.js';

/** A remote host in a URL position: `src="https://…"`, `'https://…'`, or a
 *  bare `https://host` inside a template literal. Prose mentions have no
 *  scheme immediately followed by one of these hosts in a quoted string. */
const REMOTE_IN_URL =
  /(?:src\s*=\s*["'`]|["'`])https?:\/\/(?:cdn\.tailwindcss\.com|[\w.-]*codesandbox\.io|unpkg\.com|cdn\.jsdelivr\.net|esm\.sh)/g;

/** allow-scripts + allow-same-origin defeats the sandbox entirely. */
const UNSAFE_SANDBOX = /sandbox\s*=\s*["'][^"']*allow-same-origin/g;

const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function* files(target) {
  const full = join(ROOT, target);
  if (!existsSync(full)) return;
  const stack = [full];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/__tests__/.test(child)) {
        yield child;
      }
    }
  }
}

const problems = [];

for (const target of SOURCES) {
  const full = join(ROOT, target);
  const list = existsSync(full) && full.endsWith('.ts') ? [full] : [...files(target)];
  for (const file of list) {
    const text = stripComments(readFileSync(file, 'utf8'));
    text.split('\n').forEach((line, index) => {
      for (const hit of line.matchAll(REMOTE_IN_URL)) {
        problems.push(`${relative(ROOT, file)}:${index + 1}  внешний адрес: ${hit[0].slice(0, 60)}`);
      }
      for (const hit of line.matchAll(UNSAFE_SANDBOX)) {
        problems.push(`${relative(ROOT, file)}:${index + 1}  ${hit[0]} — песочница снимает сама себя`);
      }
    });
  }
}

if (!existsSync(join(ROOT, TAILWIND))) {
  problems.push(`${TAILWIND} отсутствует — предпросмотр останется без стилей`);
}

if (problems.length) {
  console.error(
    `\nПредпросмотр артефактов показывает документы клиента и обязан быть\n` +
      `самодостаточным: никаких CDN и чужих бандлеров, песочница без\n` +
      `allow-same-origin. Нарушений: ${problems.length}\n`,
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nНужна библиотека — положите её в client/public/assets/ рядом с лицензией\n` +
      `и хэшем, как сделано с Tailwind, и ссылайтесь на неё со своего origin.\n`,
  );
  process.exit(1);
}

console.log('Артефакты: предпросмотр самодостаточен, песочница закрыта.');
