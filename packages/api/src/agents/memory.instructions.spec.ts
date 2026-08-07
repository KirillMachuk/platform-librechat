import { getMemoryInstructions, guardedMemoryInstructions, memoryInstructions } from './memory';

/**
 * The assistant is told about memory in the prompt, and what it is told decides what it
 * promises. Live on the stand it answered "Запомнил: клиент Иван Петров, телефон …" while
 * the extraction pass — reading a policy the assistant never sees — declined to store any
 * of it. Nothing was saved, nothing was shown, and the user was told the opposite.
 */
describe('what the assistant is told about memory', () => {
  it('stops promising to remember once writes are screened', () => {
    const guarded = getMemoryInstructions(true);

    expect(guarded).toBe(guardedMemoryInstructions);
    expect(guarded).toMatch(/[Nn]ever confirm/);
    expect(guarded).toMatch(/no memory tools/i);
  });

  it('says personal data is refused, so the assistant can explain the refusal itself', () => {
    const guarded = getMemoryInstructions(true);

    expect(guarded).toMatch(/personal data/i);
    expect(guarded).toMatch(/phone numbers/i);
    expect(guarded).toMatch(/not a preference you can be talked out of/i);
  });

  it('still describes what memory is for, or the assistant would not use it', () => {
    const guarded = getMemoryInstructions(true);

    expect(guarded).toMatch(/role, department/i);
    expect(guarded).toMatch(/how the user wants answers written/i);
  });

  it('leaves the unscreened wording alone, since nothing there refuses a write', () => {
    expect(getMemoryInstructions(false)).toBe(memoryInstructions);
    expect(memoryInstructions).toMatch(/automatically stores/);
  });

  it('never claims the assistant can delete a memory on request', () => {
    /** The unscreened sentence does promise this; the screened one must not, because
     *  deletion is the extraction pass's call too. */
    expect(guardedMemoryInstructions).not.toMatch(/can update or delete/i);
  });
});
