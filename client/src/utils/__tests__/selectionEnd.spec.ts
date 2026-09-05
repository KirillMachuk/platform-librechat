import { findSelectionCut, trimSelectionEnd } from '../selectionEnd';

/**
 * jsdom has Ranges and a Selection but no layout and no user-select, so these
 * exercise the trimming logic on hand-built ranges; what the browser does with
 * a real triple-click is measured in e2e/specs/mock/message-actions.spec.ts.
 */

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="before"><p>sidebar</p></div><div id="log">${html}</div><div id="outside"><p>after</p></div>`;
  return document.getElementById('log') as HTMLElement;
}

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Selection {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = document.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

const text = (el: Element | null) => el?.firstChild as Text;

describe('trimSelectionEnd', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('a paragraph selected up to the start of the next block ends at its last character', () => {
    const log = mount('<p id="a">как дела</p><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(true);
    const range = selection.getRangeAt(0);
    expect(range.endContainer).toBe(a);
    expect(range.endOffset).toBe('как дела'.length);
    expect(range.toString()).toBe('как дела');
  });

  it('a selection that already ends at its last character is left alone', () => {
    const log = mount('<p id="a">как дела</p><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, a, a.data.length);
    expect(trimSelectionEnd(selection, log)).toBe(false);
  });

  it('trailing spaces of a heading or list item are dropped, the words are kept', () => {
    const log = mount('<h2 id="a">hello world   </h2><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    trimSelectionEnd(selection, log);
    expect(selection.getRangeAt(0).toString()).toBe('hello world');
  });

  it('a pre-wrap paragraph (every message paragraph) keeps a typed trailing newline, not the block break', () => {
    const log = mount(
      '<p id="a" style="white-space: pre-wrap">line one\nline two\n</p><p id="b">next</p>',
    );
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(true);
    expect(selection.getRangeAt(0).toString()).toBe('line one\nline two\n');
  });

  it('a selection that spans a block boundary but covers no character is left alone, never collapsed', () => {
    const log = mount('<p id="a" style="white-space: pre-wrap">word</p><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    const selection = select(a, a.data.length, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(false);
    expect(selection.getRangeAt(0).collapsed).toBe(false);
  });

  it('a backward selection keeps its direction: the anchor stays on the end side', () => {
    const log = mount('<p id="a">как дела</p><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    const b = log.querySelector('#b') as Node;
    const selection = document.getSelection() as Selection;
    selection.setBaseAndExtent(b, 0, a, 0);
    expect(trimSelectionEnd(selection, log)).toBe(true);
    expect(selection.anchorNode).toBe(a);
    expect(selection.anchorOffset).toBe('как дела'.length);
    expect(selection.focusNode).toBe(a);
    expect(selection.focusOffset).toBe(0);
  });

  it('a table is text: a drag released past a table is cut inside its last covered cell', () => {
    const log = mount(
      '<p id="a">intro</p><table><tbody><tr><td id="c1">c1</td><td id="c2">c2</td></tr></tbody></table><p id="b">next</p>',
    );
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(true);
    expect(selection.getRangeAt(0).endContainer).toBe(text(log.querySelector('#c2')));
  });

  it('inside <pre> a newline is content: the covered part is kept whole', () => {
    const log = mount('<pre id="a"><code>return 1\n</code></pre><p id="b">next</p>');
    const code = text(log.querySelector('code'));
    const selection = select(code, 0, log.querySelector('#b') as Node, 0);
    trimSelectionEnd(selection, log);
    expect(selection.getRangeAt(0).toString()).toBe('return 1\n');
  });

  it('a highlighted code line whose newline sits in its own node keeps that newline', () => {
    const log = mount(
      '<pre><code><span id="l1">return 1</span><span id="nl">\n</span><span id="l2">return 2</span></code></pre><p id="b">next</p>',
    );
    const l1 = text(log.querySelector('#l1'));
    const l2 = text(log.querySelector('#l2'));
    const selection = select(l1, 0, l2, 0);
    trimSelectionEnd(selection, log);
    expect(selection.getRangeAt(0).toString()).toBe('return 1\n');
  });

  it('the paragraph break after a middle paragraph is trimmed, its own text stays whole', () => {
    const log = mount('<p id="a">first</p><p id="b">second</p><p id="c">third</p>');
    const a = text(log.querySelector('#a'));
    const b = text(log.querySelector('#b'));
    const selection = select(a, 0, log.querySelector('#c') as Node, 0);
    trimSelectionEnd(selection, log);
    const range = selection.getRangeAt(0);
    expect(range.endContainer).toBe(b);
    expect(range.endOffset).toBe('second'.length);
  });

  it('a collapsed selection is left alone', () => {
    const log = mount('<p id="a">как дела</p>');
    const a = text(log.querySelector('#a'));
    const selection = select(a, 2, a, 2);
    expect(trimSelectionEnd(selection, log)).toBe(false);
  });

  it('a selection that starts outside the transcript is left alone', () => {
    const log = mount('<p id="a">как дела</p>');
    const a = text(log.querySelector('#a'));
    const before = text(document.querySelector('#before p'));
    const selection = select(before, 0, a, 3);
    expect(trimSelectionEnd(selection, log)).toBe(false);
  });

  it('a selection that runs past the end of the transcript (the strip under the composer) is trimmed to the last character', () => {
    const log = mount('<p id="a">как дела</p>');
    const a = text(log.querySelector('#a'));
    const outside = document.querySelector('#outside') as Node;
    const selection = select(a, 0, outside, 0);
    expect(trimSelectionEnd(selection, log)).toBe(true);
    expect(selection.getRangeAt(0).toString()).toBe('как дела');
  });

  it('a selection made while a text field is active is left alone (an edit in progress)', () => {
    const log = mount('<p id="a">как дела</p><textarea id="t">draft</textarea><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    (log.querySelector('#t') as HTMLTextAreaElement).focus();
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(false);
  });

  it('a tail that holds an image is left alone: the picture stays in the copy', () => {
    const log = mount('<p id="a">look</p><p id="i"><img src="x.png" alt=""></p><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(false);
  });

  it('icon buttons under the message (out of selection) do not count as pictures in the tail', () => {
    const log = mount(
      '<p id="a">answer</p><div inert><button><svg></svg></button><button><svg></svg></button></div><p id="b">next</p>',
    );
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(true);
    expect(selection.getRangeAt(0).toString()).toBe('answer');
  });

  it('an image that merely starts at the end of the selection is not in the tail', () => {
    const log = mount('<p id="a">look</p><p id="i"><img src="x.png" alt=""></p>');
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#i') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(true);
  });

  it('text under an inert block (folded reasoning) is not where the selection ends', () => {
    const log = mount(
      '<p id="a">answer</p><div inert><p id="h">hidden thought</p></div><p id="b">next</p>',
    );
    const a = text(log.querySelector('#a'));
    const selection = select(a, 0, log.querySelector('#b') as Node, 0);
    trimSelectionEnd(selection, log);
    expect(selection.getRangeAt(0).endContainer).toBe(a);
  });

  it('a selection covering only whitespace is left alone', () => {
    const log = mount('<p id="a">word</p><p id="s">   </p><p id="b">next</p>');
    const s = text(log.querySelector('#s'));
    const selection = select(s, 0, log.querySelector('#b') as Node, 0);
    expect(trimSelectionEnd(selection, log)).toBe(false);
  });

  it('findSelectionCut names the last covered character, honouring the start offset', () => {
    const log = mount('<p id="a">one two</p><p id="b">next</p>');
    const a = text(log.querySelector('#a'));
    const range = document.createRange();
    range.setStart(a, 4);
    range.setEnd(log.querySelector('#b') as Node, 0);
    expect(findSelectionCut(range, log)).toEqual({ node: a, offset: 'one two'.length });
  });
});
