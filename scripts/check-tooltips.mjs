/**
 * Guards the tooltip canon (DESIGN_SYSTEM §6.6): EVERY hover hint is the
 * TooltipAnchor ink plate, never the browser's native `title` balloon.
 *
 * The house pattern (see Chat/Messages/HoverButtons.tsx) wraps the element in
 * `<TooltipAnchor description={...} render={<button aria-label={...} .../>} />`.
 * A native `title=` on ANY rendered element — a button, but also a truncated
 * span, a chat row div, a timestamp — draws the OS balloon instead: a second,
 * differently-styled tooltip. The first sweep (round 10) only covered
 * `<button>`/`<a>` and the owner immediately met an OS balloon on a sidebar
 * chat row (17.08), so the rule now covers every native tag.
 *
 * Run with `npm run check:tooltips`.
 *
 * What is deliberately allowed:
 *   - `<iframe title=...>` (skipped structurally) — there `title` is the
 *     frame's accessible NAME (a WCAG requirement), and no balloon ever shows
 *     over the frame's content area because the pointer is inside the child
 *     document;
 *   - `title` on a DISABLED control — disabled elements swallow pointer events,
 *     so the ariakit plate never fires there; the native balloon is the only
 *     tooltip a disabled control can show (AgentFooter's incomplete-submit);
 *   - markdown-authored `<img title>` — the chat author wrote the title in
 *     their own markdown (`![alt](src "title")`); it is content, not chrome.
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
    file: 'client/src/components/Chat/Messages/Content/MarkdownComponents.tsx',
    marker: 'title={title}',
    reason: 'markdown-authored image title (![alt](src "title")) — author content, not UI chrome',
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
 * From a native tag start, find the end of the OPENING tag. A plain
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

/* Every lowercase (native) tag. Uppercase JSX components are fine: a `title`
 * prop there is an ordinary prop (dialog headings etc.), not the DOM attribute.
 * `iframe` is skipped structurally — see the header comment. */
const TAG_START = /<([a-z][a-z0-9]*)\b/g;
const SKIP_TAGS = new Set(['iframe']);
const TITLE_ATTR = /\stitle\s*=/;

/** All native-title offenders in one file's source text. */
function findOffenders(text) {
  const offenders = [];
  const stripped = stripComments(text);
  TAG_START.lastIndex = 0;
  let match;
  while ((match = TAG_START.exec(stripped))) {
    if (SKIP_TAGS.has(match[1])) continue;
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
    '<div className="truncate" title={fullName}>x</div>',
    '<span\n  className="truncate text-xs"\n  title={card}\n>x</span>',
    '<time dateTime={iso} title={absolute}>x</time>',
    '<article title="any native tag counts">x</article>',
  ];
  const mustPass = [
    '<button aria-label="x" onClick={() => setTitle("title=")}>x</button>',
    '<OGDialogTemplate title={localize(\'com_ui_terms\')} main={x} />',
    '<TooltipAnchor description={name} render={<div className="truncate" />}>x</TooltipAnchor>',
    '<iframe title="Preview: report.pdf" src={url} />',
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
    `\nDESIGN_SYSTEM §6.6: every hover hint is the TooltipAnchor ink plate — the\n` +
      `native title balloon is banned on ALL native tags, not only controls\n` +
      `(truncated text included). These ${problems.length} drift:\n`,
  );
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nWrap the element: <TooltipAnchor description={text} render={<div ... />}>\n` +
      `...</TooltipAnchor> (TooltipAnchor from '@librechat/client'; see\n` +
      `Conversations/ConvoLink.tsx for a text row, Chat/Messages/HoverButtons.tsx\n` +
      `for a control) and drop the title attribute. Pass className="cursor-default"\n` +
      `on non-clickable text. A title that must stay (disabled control, markdown\n` +
      `author content) goes into ALLOWLIST in this script with its reason.\n`,
  );
  process.exit(1);
}

console.log('Tooltip canon: ink plates only, no native title balloons on any tag.');
