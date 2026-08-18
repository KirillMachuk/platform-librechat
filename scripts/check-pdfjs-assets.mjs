/**
 * Guards the vendored pdf.js decoders.
 *
 * pdf.js 5 decodes JBIG2, JPEG2000 and colour profiles in WebAssembly and
 * refuses to guess where those files live. The viewer points at
 * `client/public/assets/pdfjs/`, so a copy that is missing — or left behind by
 * a version bump — shows up as blank pages in a scanned document, after the
 * viewer has already reported itself ready. Nothing else in the app would say
 * a word about it.
 *
 * Run with `npm run check:pdfjs-assets`.
 */
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendored = path.join(root, 'client/public/assets/pdfjs');
const source = path.join(root, 'node_modules/pdfjs-dist/wasm');
const FILES = ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm'];

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const problems = [];
for (const name of FILES) {
  const copy = path.join(vendored, name);
  const original = path.join(source, name);
  if (!existsSync(copy)) {
    problems.push(`${name}: missing from client/public/assets/pdfjs`);
    continue;
  }
  if (!existsSync(original)) {
    /* No install to compare against (a lint-only CI job). Presence is all we
       can check there, and it is still worth checking. */
    continue;
  }
  if (digest(copy) !== digest(original)) {
    problems.push(`${name}: differs from the installed pdfjs-dist — re-copy it`);
  }
}

if (problems.length > 0) {
  console.error('Vendored pdf.js decoders are out of step:');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error('\nFix with:\n  cp node_modules/pdfjs-dist/wasm/*.wasm client/public/assets/pdfjs/');
  process.exit(1);
}

console.log(`pdf.js decoders: ${FILES.length} vendored copies match the installed package.`);
