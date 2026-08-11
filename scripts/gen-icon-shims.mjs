/**
 * Generates the two icon shims from `scripts/icons.map.json`.
 *
 * The app draws TABLER icons (owner's decision 11.08 evening: Phosphor's
 * filled contours read as sharp-cornered; Tabler is stroke-drawn with round
 * caps and joins — tabler.io is the catalog the owner picked from, stroke
 * 1.25 canonical) while the code keeps the lucide NAMES it always had. The
 * shim is where the two meet: one generated file per workspace exporting each
 * Tabler icon under the semantic name the code already uses, so the migration
 * is an import-source change and future icon swaps are a map edit.
 *
 * Names stay deliberately semantic-by-history: a component called `Search`
 * renders Tabler's IconSearch, and `SquarePen` renders IconEdit. The name
 * says what it MEANS, the map says what it DRAWS. Do not "fix" call sites to
 * Tabler names — the map is the single place that knows.
 *
 * Stroke width is owned twice on purpose, with one value: the wrapper sets
 * the 1.25 svg attribute (covers icons sized by hand, e.g. `h-5 w-5`), and
 * `--c-ic-sw: 1.25` in style.css wins over it via the ladder classes — CSS
 * presentation properties beat presentation attributes, which is also why a
 * deliberate `stroke-[…]` class in markup still works.
 *
 * lucide-react itself STAYS in package.json: the artifact sandbox pins it for
 * model-generated code (`check:icons` guards that pin). The app just no
 * longer imports it.
 *
 * Run: node scripts/gen-icon-shims.mjs   (rewrites both shims; commit them)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(readFileSync(join(ROOT, 'scripts/icons.map.json'), 'utf8'));

/* Icons that keep lucide's geometry: the two subjects Tabler does not draw
   (no dashed message bubble, no slashed square in its catalog). Each is a
   stroke icon on a 24 grid, same construction as Tabler, so they blend in;
   their stroke width follows the same canon.
   `Bot` left this list 11.08-4: the owner picked `sparkles` for agents, so
   the mapping covers it and the hand-kept robot is gone. */
const CUSTOM = {
  MessageSquareDashed: `<path d="M14 3h2" /><path d="M16 19h-2" /><path d="M2 12v-2" /><path d="M2 16v5.286a.71.71 0 0 0 1.212.502l1.149-1.149" /><path d="M20 19a2 2 0 0 0 2-2v-1" /><path d="M22 10v2" /><path d="M22 6V5a2 2 0 0 0-2-2" /><path d="M4 3a2 2 0 0 0-2 2v1" /><path d="M8 19h2" /><path d="M8 3h2" />`,
  SquareSlash: `<rect width="18" height="18" x="3" y="3" rx="2" /><line x1="9" x2="15" y1="15" y2="9" />`,
};

const entries = Object.entries(map);
/* A name listed in CUSTOM draws inline even when the map has a target for
   it — that is how a rejected pick is overridden without losing the
   mapping's record of what it would otherwise have been. */
const reexports = entries.filter(([k, v]) => v.to !== null && !CUSTOM[k]);
const missing = entries.filter(([k, v]) => v.to === null || CUSTOM[k]).map(([k]) => k);
for (const name of missing) {
  if (!CUSTOM[name]) throw new Error(`no inline geometry for unmapped icon ${name}`);
}

/* Two lucide names that DRAW DIFFERENTLY must not land on one Tabler icon
   IF the code uses them together in one file — that is where a two-branch
   toggle lives, and collapsing its branches makes a control that cannot show
   its state. `Copy` and `CopyCheck` did exactly that once: the copy button
   drew the same glyph before and after copying.

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
      `Tabler icon, and are used in the same file — a control switching between them ` +
      `would not change:\n  ` +
      collisions.join('\n  ') +
      `\nGive one of each pair its own target, or add it to CUSTOM to keep its own drawing.`,
  );
}

/** 'arrows-split-2' → 'IconArrowsSplit2' — Tabler's export naming. */
const tablerName = (target) =>
  'Icon' +
  target
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const imported = [...new Set(reexports.map(([, v]) => tablerName(v.to)))].sort();

const header = `/**
 * GENERATED by scripts/gen-icon-shims.mjs from scripts/icons.map.json — edit
 * the map, not this file.
 *
 * The app's icons are Tabler (outline, stroke 1.25 — the canon token
 * \`--c-ic-sw\` wins over the attribute wherever a ladder class is present)
 * under the semantic names the code has always used: \`Search\` here IS
 * Tabler's IconSearch. \`LucideIcon\` stays exported as the component type
 * name the codebase knows; it is Tabler's icon type now.
 */
/* eslint-disable */
import * as React from 'react';
import type { IconProps } from '@tabler/icons-react';
import {
${imported.map((n) => `  ${n},`).join('\n')}
} from '@tabler/icons-react';

export type LucideIcon = React.ComponentType<IconProps>;

/** The canon's stroke as a default the call site can still override. */
const canon = (Target: LucideIcon, displayName: string): LucideIcon => {
  const C = React.forwardRef<SVGSVGElement, IconProps>((props, ref) =>
    React.createElement(Target, { stroke: 1.25, ref, ...props }),
  );
  C.displayName = displayName;
  return C as unknown as LucideIcon;
};

`;

const customBlock = `
/* ---- not in Tabler's catalog: geometry kept inline until redrawn ---- */

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
      strokeWidth: 1.25,
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
  `/* The name is what it means, the target is what Tabler calls it. */\n` +
  reexports
    .map(([k, v]) => `export const ${k}: LucideIcon = canon(${tablerName(v.to)}, '${k}');`)
    .join('\n') +
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
  console.log(
    `written ${target}: ${reexports.length} mapped (${imported.length} tabler icons), ${missing.length} inline`,
  );
}
