/**
 * Guards the tooltip canon (DESIGN_SYSTEM §6.6): interactive controls get the
 * TooltipAnchor ink plate, not the browser's native `title` balloon.
 *
 * The house pattern (see Chat/Messages/HoverButtons.tsx) wraps the control in
 * `<TooltipAnchor description={...} render={<button aria-label={...} .../>} />`.
 * A native `title=` on a `<button>` or `<a>` draws the OS balloon instead —
 * a second, differently-styled tooltip the redesign already removed once.
 *
 * Run with `npm run check:tooltips`.
 *
 * What is deliberately allowed (ALLOWLIST below):
 *   - `title` on a DISABLED control — disabled elements swallow pointer events,
 *     so the ariakit plate never fires there; the native balloon is the only
 *     tooltip a disabled control can show (AgentFooter's incomplete-submit);
 *   - the TTS fallback buttons — upstream render path kept verbatim;
 *   - sites outside this sweep's scope, listed explicitly so the next sweep
 *     finds them here instead of rediscovering them.
 *
 * Matching is by file + a `marker` substring of the offending opening tag, not
 * by line number: line numbers drift with every edit above the site and a
 * drifted allowlist silently allows the wrong thing. A marker that no longer
 * matches anything fails the run — a stale entry is itself a defect (the
 * "matcher that matches nothing" lesson).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['client/src/components', 'packages/client/src/components'];
const EXTENSIONS = /\.(tsx|jsx)$/;
const SKIP = /__tests__|\.(spec|test)\.[tj]sx?$/;

/** file is repo-relative (posix); marker must appear inside the offending opening tag. */
const ALLOWLIST = [
  {
    file: 'client/src/components/SidePanel/Agents/AgentFooter.tsx',
    marker: 'title={isIncomplete',
    reason: 'disabled submit: native title is the only tooltip firing on disabled controls',
  },
  {
    file: 'client/src/components/Audio/TTS.tsx',
    marker: 'title={title}',
    reason: 'fallback render path without TooltipAnchor (BrowserTTS)',
  },
  {
    file: 'client/src/components/Audio/TTS.tsx',
    marker: "title={isSpeaking === true ? localize('com_ui_stop')",
    reason: 'fallback render path without TooltipAnchor (ExternalTTS)',
  },
  {
    file: 'client/src/components/Prompts/fields/PromptName.tsx',
    marker: 'title={newName}',
    reason: 'truncated prompt name: title reveals the full text, not a control label',
  },
];

/** Blank out block comments, preserving newlines so reported lines stay true. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(child, out);
      continue;
    }
    if (EXTENSIONS.test(entry.name) && !SKIP.test(child)) out.push(child);
  }
  return out;
}

/**
 * From a `<button` / `<a` start, find the end of the OPENING tag. A plain
 * "first `>`" scan fails on JSX — `onClick={() => ...}` closes the tag two
 * attributes early — so this walks with brace depth and quote state: the tag
 * ends at the first `>` that sits at depth 0 outside any string. Returns the
 * tag's end index plus `top`, the tag text with everything nested in braces
 * or quotes blanked, so attribute NAMES can be matched without expression
 * bodies faking a `title=`.
 */
function readOpeningTag(text, start) {
  let depth = 0;
  let quote = null;
  const top = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
      top.push(ch === '\n' ? '\n' : ' ');
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      top.push(' ');
      continue;
    }
    if (ch === '{') {
      depth++;
      top.push(' ');
      continue;
    }
    if (ch === '}') {
      depth--;
      top.push(' ');
      continue;
    }
    if (depth === 0 && ch === '>') return { end: i, top: top.join('') };
    if (depth === 0 || ch === '\n') {
      top.push(ch);
    } else {
      top.push(' ');
    }
  }
  return null;
}

const TAG_START = /<(button|a)\b/g;
const TITLE_ATTR = /\stitle\s*=/;

/** All native-title offenders in one file's source text. */
function findOffenders(text) {
  const offenders = [];
  const stripped = stripComments(text);
  TAG_START.lastIndex = 0;
  let match;
  while ((match = TAG_START.exec(stripped))) {
    const tag = readOpeningTag(stripped, match.index);
    if (!tag || !TITLE_ATTR.test(tag.top)) continue;
    offenders.push({
      line: stripped.slice(0, match.index).split('\n').length,
      source: stripped.slice(match.index, tag.end + 1),
    });
  }
  return offenders;
}

/**
 * The matcher proves itself on fixtures before judging the tree — a regex
 * that quietly matches nothing would otherwise report a clean sweep forever.
 */
function selfCheck() {
  const mustCatch = [
    '<button title="x">go</button>',
    '<button type="button"\n  onClick={() => go(a > b)}\n  title={localize(\'com_ui_x\')}\n>',
    '<a href="/x" title={name}>x</a>',
  ];
  const mustPass = [
    '<button aria-label="x" onClick={() => setTitle("title=")}>x</button>',
    '<article title="not a control">x</article>',
    '/* <button title="commented out"> */\n<button aria-label="x">x</button>',
  ];
  const missed = mustCatch.filter((probe) => findOffenders(probe).length === 0);
  const phantom = mustPass.filter((probe) => findOffenders(probe).length > 0);
  if (missed.length || phantom.length) {
    console.error('check-tooltips: matcher self-check FAILED — fix the matcher, not the tree.');
    for (const probe of missed) console.error(`  missed:  ${probe.replace(/\n/g, ' ')}`);
    for (const probe of phantom) console.error(`  phantom: ${probe.replace(/\n/g, ' ')}`);
    process.exit(1);
  }
}

selfCheck();

const problems = [];
const usedAllowlist = new Set();
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const rel = relative(ROOT, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    for (const offender of findOffenders(text)) {
      const allowed = ALLOWLIST.find(
        (entry) => entry.file === rel && offender.source.includes(entry.marker),
      );
      if (allowed) {
        usedAllowlist.add(allowed);
        continue;
      }
      const preview = offender.source.replace(/\s+/g, ' ').slice(0, 100);
      problems.push(`${rel}:${offender.line}  ${preview}`);
    }
  }
}

for (const entry of ALLOWLIST) {
  if (usedAllowlist.has(entry)) continue;
  problems.push(
    `stale allowlist entry: ${entry.file} (marker "${entry.marker}" matched nothing — remove or fix it)`,
  );
}

if (problems.length) {
  console.error(
    `\nDESIGN_SYSTEM §6.6: controls use the TooltipAnchor ink plate, not the native\n` +
      `title balloon. These ${problems.length} drift:\n`,
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nWrap the control: <TooltipAnchor description={text} render={<button ...\n` +
      `aria-label={text}>...</button>} /> (TooltipAnchor from '@librechat/client';\n` +
      `see Chat/Messages/HoverButtons.tsx) and drop the title attribute. A title\n` +
      `that must stay (disabled control, out-of-scope site) goes into ALLOWLIST\n` +
      `in this script with its reason.\n`,
  );
  process.exit(1);
}

console.log('Tooltip canon: ink plates only, no native title balloons on controls.');
