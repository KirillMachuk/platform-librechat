/**
 * Ends a mouse selection at the last character it actually covers.
 *
 * A triple-click in Chromium selects the paragraph AND the "paragraph break"
 * after it — the range ends at the start of whatever block comes next — and
 * the browser serialises that break as two newlines for a `<p>` (the HTML
 * innerText rule: a paragraph carries a required line break count of 2).
 * The same happens to a drag released below the last line. So a copied
 * message arrived as «текст» plus two empty lines even after the toolbar row
 * under it was taken out of selection (#473) — the owner's complaint, still
 * open. Editors (ProseMirror, CKEditor) solve this by owning the selection
 * bounds themselves; this does the same for the transcript: after the mouse
 * is released, the end of the selection is moved back to the last selected
 * character, so the native copy — text/plain AND text/html — serialises the
 * text and nothing after it.
 *
 * The contract, each line with a unit case:
 * - a collapsed selection, or any selection while a text field is focused
 *   (an edit in progress — a field's own selection is a collapsed DOM range
 *   in Chromium, and the field keeps focus through the drag), is left alone;
 * - a selection that STARTS outside the transcript is left alone; one that
 *   ends after it (the strip under the composer, the composer itself — where
 *   a triple-click on the last message and a drag released below it end) is
 *   trimmed back to the last character of the transcript it covers;
 * - a tail that holds a selectable picture (image, video, canvas…) is left
 *   alone: the drag took it on purpose and the trim would drop it from the
 *   text/html copy. Icon buttons under a message and the composer after it
 *   are out of selection and do not count; a table is text like any other;
 * - preformatted text (`pre`, `pre-wrap`, `pre-line` — every message
 *   paragraph here is pre-wrap) keeps every character it covers: a typed
 *   newline or a code line's newline is content. The last line of a code
 *   block still copies without a trailing newline — Chromium serialises a
 *   newline only when the range leaves the block;
 * - elsewhere (headings, list items, cells) the cut lands right after the
 *   last visible character;
 * - text under `inert` or `user-select: none` is never where the cut lands;
 * - the selection never collapses and its direction is kept.
 *
 * Deliberately out of scope: touch selections (made with the browser's own
 * handles, which dispatch no release), and — the one trade-off of owning the
 * bounds — after a triple-click a Shift+click extends by characters, not by
 * paragraphs, because the trim resets the browser's selection granularity.
 * A keyboard-made selection is trimmed at the next left-button release.
 */

const NOT_WHITESPACE = /[^\s\u200B-\u200D\u2060\uFEFF]/;
const REPLACED_ELEMENTS = new Set([
  'IMG',
  'PICTURE',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'SVG',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);
const TEXT_FIELD =
  'textarea, input, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

function lastNonWhitespaceIndex(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (NOT_WHITESPACE.test(text[i])) {
      return i;
    }
  }
  return -1;
}

/** `user-select: none` is inherited as a used value only in Blink; walk up. */
function isSelectableFrom(start: Element | null): boolean {
  let el = start;
  while (el) {
    if (el.hasAttribute('inert')) {
      return false;
    }
    const style = getComputedStyle(el);
    const value = style.userSelect || style.webkitUserSelect;
    if (value === 'none') {
      return false;
    }
    if (value && value !== 'auto') {
      return true;
    }
    el = el.parentElement;
  }
  return true;
}

function isSelectable(node: Text): boolean {
  return isSelectableFrom(node.parentElement);
}

/** A newline is content inside preformatted text: keep the node's tail whole. */
function keepsWhitespace(node: Text): boolean {
  const el = node.parentElement;
  if (!el) {
    return false;
  }
  if (el.closest('pre')) {
    return true;
  }
  return getComputedStyle(el).whiteSpace.startsWith('pre');
}

export interface SelectionCut {
  node: Text;
  offset: number;
}

/**
 * The last character the range covers: the last selectable text node with a
 * non-whitespace character strictly before the range end, cut right after
 * its last non-whitespace character (or after its whole covered part inside
 * preformatted text). Null when the range covers no text at all.
 */
export function findSelectionCut(range: Range, root: Node): SelectionCut | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /* Start where the selection starts, not at the top of the transcript: the
   * nodes before it are never candidates, and a long chat has thousands. */
  const start = range.startContainer;
  walker.currentNode = start;
  let cut: SelectionCut | null = null;
  for (
    let node = (start.nodeType === Node.TEXT_NODE ? start : walker.nextNode()) as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    const length = node.data.length;
    if (length === 0) {
      continue;
    }
    if (range.comparePoint(node, 0) > 0) {
      /* Starts after the end: nothing further can be covered. */
      break;
    }
    /* The part of this node inside the range. A boundary inside a text node
     * always names that node as its container. */
    const from = range.startContainer === node ? range.startOffset : 0;
    const to = range.endContainer === node ? range.endOffset : length;
    if (to <= from || !isSelectable(node)) {
      continue;
    }
    const part = node.data.slice(from, to);
    /* Preformatted text keeps every character it covers — a newline is
     * content there, even when a highlighter puts it in a node of its own;
     * elsewhere the cut is right after the last visible character. */
    if (keepsWhitespace(node)) {
      cut = { node, offset: to };
      continue;
    }
    if (!NOT_WHITESPACE.test(part)) {
      continue;
    }
    cut = { node, offset: from + lastNonWhitespaceIndex(part) + 1 };
  }
  return cut;
}

/**
 * True when a selectable replaced element sits between the cut and the range
 * end — a picture the drag took along. Only the transcript's own content
 * counts: the icon buttons under a message and the composer after it are
 * out of selection, not something the user meant to copy, and the strict
 * containment test keeps an element that merely starts AT the end (offset 0
 * of the next block) from counting as covered.
 */
function tailHoldsReplacedElement(range: Range, cut: SelectionCut, container: Node): boolean {
  const tail = document.createRange();
  tail.setStart(cut.node, cut.offset);
  tail.setEnd(range.endContainer, range.endOffset);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = cut.node;
  for (let el = walker.nextNode() as Element | null; el; el = walker.nextNode() as Element | null) {
    if (tail.comparePoint(el, 0) > 0) {
      break;
    }
    if (REPLACED_ELEMENTS.has(el.tagName.toUpperCase()) && isSelectableFrom(el)) {
      return true;
    }
  }
  return false;
}

/**
 * A triple-click on the LAST message ends in whatever follows the transcript
 * (the strip under the composer, measured), and a drag released below the
 * last message ends there too — those are exactly the selections to trim, so
 * the end may lie after the container. An end BEFORE it (a drag up into the
 * header or the sidebar) is a selection that starts outside and is left alone
 * by the start check.
 */
function endsInOrAfter(range: Range, container: Node): boolean {
  if (container.contains(range.endContainer)) {
    return true;
  }
  const position = container.compareDocumentPosition(range.endContainer);
  return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
}

function isForward(selection: Selection): boolean {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!anchorNode || !focusNode) {
    return true;
  }
  if (anchorNode === focusNode) {
    return anchorOffset <= focusOffset;
  }
  const position = anchorNode.compareDocumentPosition(focusNode);
  return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Trims the selection's end to the last character it covers. Returns true
 * when the selection was changed. Safe to call repeatedly: a trimmed
 * selection is left as it is.
 */
export function trimSelectionEnd(selection: Selection, container: Node): boolean {
  if (selection.rangeCount !== 1) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return false;
  }
  if (!container.contains(range.startContainer) || !endsInOrAfter(range, container)) {
    return false;
  }
  const active = document.activeElement;
  if (active && active.matches(TEXT_FIELD)) {
    return false;
  }
  const cut = findSelectionCut(range, container);
  if (!cut) {
    return false;
  }
  if (range.endContainer === cut.node && range.endOffset === cut.offset) {
    return false;
  }
  if (tailHoldsReplacedElement(range, cut, container)) {
    return false;
  }
  if (typeof selection.setBaseAndExtent !== 'function') {
    /* No way to keep the direction here (very old WebKit): the trim still
     * lands, the selection just becomes forward. */
    range.setEnd(cut.node, cut.offset);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  /* Keep the direction: a backward drag has its anchor at the end. */
  if (isForward(selection)) {
    selection.setBaseAndExtent(range.startContainer, range.startOffset, cut.node, cut.offset);
  } else {
    selection.setBaseAndExtent(cut.node, cut.offset, range.startContainer, range.startOffset);
  }
  return true;
}
