/**
 * Generates the two icon shims from `scripts/icons.map.json`.
 *
 * The app draws Phosphor icons (owner's decision 10.08: ChatGPT-like drawing —
 * measured 6.25% stroke vs ChatGPT's 6.65%, round caps, Fill weight for active
 * states) while the code keeps the lucide NAMES it always had. The shim is
 * where the two meet: one generated file per workspace re-exporting each
 * Phosphor icon under the semantic name the code already uses, so the
 * migration is an import-source change and future icon swaps are a map edit.
 *
 * Names stay deliberately semantic-by-history: a component called `Search`
 * renders Phosphor's MagnifyingGlass. The name says what it MEANS, the map
 * says what it DRAWS. Do not "fix" call sites to Phosphor names — the map is
 * the single place that knows.
 *
 * lucide-react itself STAYS in package.json: the artifact sandbox pins it for
 * model-generated code (`check:icons` guards that pin). The app just no longer
 * imports it.
 *
 * Run: node scripts/gen-icon-shims.mjs   (rewrites both shims; commit them)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(readFileSync(join(ROOT, 'scripts/icons.map.json'), 'utf8'));

/* Icons that keep lucide's geometry: the three subjects Phosphor never drew
   (catalog frozen since 2024), plus `Bot` — Phosphor's Robot has a face, and
   the owner called it too cartoonish for the Agents section, which sits in the
   sidebar all day. Each is a stroke icon on a 24 grid, unlike Phosphor's
   filled 256 grid, so they take lucide's stroke styling explicitly. */
const CUSTOM = {
  Bot: `<path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />`,
  MessageCircleDashed: `<path d="M10.1 2.182a10 10 0 0 1 3.8 0" /><path d="M13.9 21.818a10 10 0 0 1-3.8 0" /><path d="M17.609 3.72a10 10 0 0 1 2.69 2.7" /><path d="M2.182 13.9a10 10 0 0 1 0-3.8" /><path d="M20.28 17.61a10 10 0 0 1-2.7 2.69" /><path d="M21.818 10.1a10 10 0 0 1 0 3.8" /><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" /><path d="m6.163 21.117-2.906.85a1 1 0 0 1-1.236-1.169l.965-2.98" />`,
  MessageSquareDashed: `<path d="M14 3h2" /><path d="M16 19h-2" /><path d="M2 12v-2" /><path d="M2 16v5.286a.71.71 0 0 0 1.212.502l1.149-1.149" /><path d="M20 19a2 2 0 0 0 2-2v-1" /><path d="M22 10v2" /><path d="M22 6V5a2 2 0 0 0-2-2" /><path d="M4 3a2 2 0 0 0-2 2v1" /><path d="M8 19h2" /><path d="M8 3h2" />`,
  SquareSlash: `<rect width="18" height="18" x="3" y="3" rx="2" /><line x1="9" x2="15" y1="15" y2="9" />`,
};

const entries = Object.entries(map);
/* A name listed in CUSTOM draws from lucide even when the map has a Phosphor
   target for it — that is how a rejected pick is overridden without losing the
   mapping's record of what it would otherwise have been. */
const reexports = entries.filter(([k, v]) => v.to !== null && !CUSTOM[k]);
const missing = entries.filter(([k, v]) => v.to === null || CUSTOM[k]).map(([k]) => k);
for (const name of missing) {
  if (!CUSTOM[name]) throw new Error(`no inline geometry for unmapped icon ${name}`);
}

/* Grouped so a reader can audit renames at a glance: identity re-exports
   first, renames after, each rename on its own line. */
/* Two lucide names that DRAW DIFFERENTLY must not land on one Phosphor icon
   IF the code uses them together in one file — that is where a two-branch
   toggle lives, and collapsing its branches makes a control that cannot show
   its state. `Copy` and `CopyCheck` did exactly that: the copy button drew
   the same glyph before and after copying.

   Synonyms are deliberately allowed. `Cog` and `Settings` draw differently in
   lucide but mean one thing and never appear as alternatives; merging them is
   the point of a mapping. So geometry alone does not fail the build —
   geometry AND co-occurrence do.

   Both halves are read from disk, not asserted: the drawing from the installed
   lucide, the co-occurrence from the source tree. */
const LUCIDE = join(ROOT, 'node_modules/lucide-react/dist/esm/icons');
const kebab = (n) =>
  n
    .replace(/Icon$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
const lucideShape = (name) => {
  for (const candidate of [kebab(name), `${kebab(name)}-icon`]) {
    const file = join(LUCIDE, `${candidate}.js`);
    if (!existsSync(file)) continue;
    const block = /const __iconNode = \[([\s\S]*?)\n\];/.exec(readFileSync(file, 'utf8'));
    if (block) return block[1].replace(/,\s*key:\s*"[^"]*"/g, '').replace(/\s+/g, '');
  }
  return null;
};

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') yield* sources(child);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && entry.name !== 'icons.tsx') {
      yield child;
    }
  }
}
const files = [];
for (const root of ['client/src', 'packages/client/src']) {
  for (const file of sources(join(ROOT, root))) files.push(readFileSync(file, 'utf8'));
}
const usedTogether = (a, b) => {
  const re = (n) => new RegExp(`\\b${n}\\b`);
  return files.some((text) => re(a).test(text) && re(b).test(text));
};

const byTarget = new Map();
for (const [name, value] of reexports) {
  if (!byTarget.has(value.to)) byTarget.set(value.to, []);
  byTarget.get(value.to).push(name);
}
const collisions = [];
for (const [target, names] of byTarget) {
  if (names.length < 2) continue;
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [a, b] = [names[i], names[j]];
      const [sa, sb] = [lucideShape(a), lucideShape(b)];
      if (!sa || !sb || sa === sb) continue;
      if (usedTogether(a, b)) collisions.push(`${target} ← ${a} + ${b}`);
    }
  }
}
if (collisions.length) {
  throw new Error(
    `icons.map.json: ${collisions.length} pair(s) draw differently in lucide, land on one ` +
      `Phosphor icon, and are used in the same file — a control switching between them ` +
      `would not change:\n  ` +
      collisions.join('\n  ') +
      `\nGive one of each pair its own target, or add it to CUSTOM to keep lucide's drawing.`,
  );
}

const identity = reexports.filter(([k, v]) => k === v.to).map(([k]) => k);
const renamed = reexports.filter(([k, v]) => k !== v.to);

const header = `/**
 * GENERATED by scripts/gen-icon-shims.mjs from scripts/icons.map.json — edit
 * the map, not this file.
 *
 * The app's icons are Phosphor (weight Regular; pass weight="fill" for active
 * states) under the semantic names the code has always used: \`Search\` here
 * IS Phosphor's MagnifyingGlass. \`LucideIcon\` stays exported as the component
 * type name the codebase knows; it is Phosphor's Icon type now.
 */
/* eslint-disable */
import * as React from 'react';
import type { Icon } from '@phosphor-icons/react';

export type LucideIcon = Icon;

`;

const customBlock = `
/* ---- not in Phosphor's catalog: lucide geometry inline until redrawn ---- */

type SvgProps = React.SVGProps<SVGSVGElement> & { size?: number | string };

const custom = (paths: string, displayName: string): LucideIcon => {
  const C = React.forwardRef<SVGSVGElement, SvgProps>(({ size = '1em', ...props }, ref) =>
    React.createElement('svg', {
      ref,
      xmlns: 'http://www.w3.org/2000/svg',
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      ...props,
      dangerouslySetInnerHTML: { __html: paths },
    }),
  );
  C.displayName = displayName;
  return C as unknown as LucideIcon;
};

`;

const customExports = missing
  .map((k) => `export const ${k}: LucideIcon = custom(${JSON.stringify(CUSTOM[k])}, '${k}');`)
  .join('\n');

const body =
  `/* Same subject, same name in both sets. */\nexport {\n` +
  identity.map((k) => `  ${k},`).join('\n') +
  `\n} from '@phosphor-icons/react';\n\n` +
  `/* Renames: the name is what it means, the target is what Phosphor calls it. */\n` +
  renamed.map(([k, v]) => `export { ${v.to} as ${k} } from '@phosphor-icons/react';`).join('\n') +
  `\n` +
  customBlock +
  customExports +
  `\n`;

const out = header + body;
for (const target of [
  'client/src/components/icons.tsx',
  'packages/client/src/components/icons.tsx',
]) {
  writeFileSync(join(ROOT, target), out);
  console.log(`written ${target}: ${identity.length} same-name, ${renamed.length} renamed, ${missing.length} inline`);
}
