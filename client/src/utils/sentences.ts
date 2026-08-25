const SENTENCE_END = /[.!?…]/;

/**
 * Splits streaming reasoning text into display sentences for the thinking
 * preview (cards К4). Prefix-stable by construction: the split walks left to
 * right and a completed sentence never changes once emitted, so appending
 * text can only grow the tail or add rows — rendered rows never reflow.
 * A sentence break is honored only at «end punctuation + whitespace» (or a
 * newline), so "3.14" and "т.д." stay whole.
 */
export function splitThinkSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const line of text.split('\n')) {
    let current = '';
    for (let i = 0; i < line.length; i++) {
      current += line[i];
      if (SENTENCE_END.test(line[i]) && !SENTENCE_END.test(line[i + 1] ?? '')) {
        const next = line[i + 1];
        if (next === undefined || next === ' ' || next === '\t') {
          const sentence = current.trim();
          if (sentence) {
            sentences.push(sentence);
          }
          current = '';
        }
      }
    }
    const tail = current.trim();
    if (tail) {
      sentences.push(tail);
    }
  }
  return sentences;
}
