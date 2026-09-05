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
 * What it deliberately leaves alone:
 * - collapsed selections, and any selection while a text field is active or
 *   the release happened inside one — a textarea reports its own selection
 *   as a collapsed DOM range in Chromium, and touching it would destroy the
 *   edit the user is making;
 * - selections that start or end outside the transcript;
 * - a tail that holds a replaced element (an image, a table, a video…):
 *   the drag took the picture along on purpose, and the trim would drop it
 *   from the text/html copy;
 * - trailing newlines INSIDE `<pre>`/`white-space: pre` text — in a code
 *   block a newline is content;
 * - keyboard-made and touch-made selections (no mouse release to hook; on
 *   phones the selection handles are browser chrome and a trim on every
 *   change would fight them).
 */

const NOT_WHITESPACE = /[^\s\u200B-\u200D\u2060\uFEFF]/;
const REPLACED_ELEMENTS = 'img, picture, video, audio, canvas, svg, iframe, object, embed, table';
const TEXT_FIELD = 'textarea, input, [contenteditable=""], [contenteditable="true"]';

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
  let cut: SelectionCut | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (length === 0) {
      continue;
    }
    if (range.comparePoint(node, 0) > 0) {
      /* Starts after the end: nothing further can be covered. */
      break;
    }
    if (range.comparePoint(node, length) < 0) {
      /* Ends before the start: not part of the selection. */
      continue;
    }
    /* The part of this node inside the range. A boundary inside a text node
     * always names that node as its container. */
    const from = range.startContainer === node ? range.startOffset : 0;
    const to = range.endContainer === node ? range.endOffset : length;
    if (!isSelectable(node)) {
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
  const root =
    container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  if (!root) {
    return false;
  }
  for (const el of Array.from(root.querySelectorAll(REPLACED_ELEMENTS))) {
    if (tail.comparePoint(el, 0) === 0 && isSelectableFrom(el)) {
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
    /* No way to keep the direction here (jsdom, very old WebKit): the trim
     * still lands, the selection just becomes forward. */
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

/** True when the mouse release should be ignored: it landed in a text field. */
export function releasedInTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_FIELD) != null;
}
