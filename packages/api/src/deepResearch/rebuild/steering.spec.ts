import {
  SteeringMailbox,
  getSteering,
  registerSteering,
  unregisterSteering,
  MAX_STEER_CHARS,
  MAX_STEERS_PER_RUN,
} from './steering';

const message = (messageId: string) => ({ messageId, text: `raw ${messageId}` });

describe('SteeringMailbox', () => {
  it('starts on the request message and moves its head onto every accepted clarification', () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    expect(box.headMessageId).toBe('um1');
    box.add({ text: 'не Минск, а вся область', message: message('s1') });
    expect(box.headMessageId).toBe('s1');
    box.add({ text: 'и только 2026 год', message: message('s2') });
    expect(box.headMessageId).toBe('s2');
    expect(box.size).toBe(2);
  });

  it('hands the graph the texts and the chat the messages, oldest first, never mixed', () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    box.add({ text: '[PERSON_1] — не тот', message: { messageId: 's1', text: 'Иванов — не тот' } });
    box.add({ text: 'второе', message: message('s2') });
    expect(box.texts()).toEqual(['[PERSON_1] — не тот', 'второе']);
    expect(box.messages().map((m) => m.messageId)).toEqual(['s1', 's2']);
    expect(box.messages()[0].text).toBe('Иванов — не тот');
  });

  it('refuses empty, over-long, over-the-limit, and report-phase clarifications with a named reason', () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    expect(box.refusal('   ')).toBe('empty');
    expect(box.refusal('x'.repeat(MAX_STEER_CHARS + 1))).toBe('length');
    expect(box.refusal('x'.repeat(MAX_STEER_CHARS))).toBeNull();
    for (let i = 0; i < MAX_STEERS_PER_RUN; i++) {
      box.add({ text: `s${i}`, message: message(`s${i}`) });
    }
    expect(box.refusal('ещё одно')).toBe('limit');

    const late = new SteeringMailbox({ headMessageId: 'um1' });
    late.phase = 'report';
    expect(late.refusal('поздно')).toBe('report');
    late.phase = 'closed';
    expect(late.refusal('поздно')).toBe('closed');
  });

  it('takes back only the LAST entry, and the head returns to the previous message', () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    box.add({ text: 'a', message: message('s1') });
    box.add({ text: 'b', message: message('s2') });
    /* An earlier entry may already be the parent of a later one: never removed. */
    expect(box.remove('s1')).toBe(false);
    expect(box.headMessageId).toBe('s2');
    expect(box.remove('s2')).toBe(true);
    expect(box.headMessageId).toBe('s1');
    expect(box.texts()).toEqual(['a']);
    expect(box.remove('s1')).toBe(true);
    expect(box.headMessageId).toBe('um1');
    expect(box.remove('nothing')).toBe(false);
  });

  it('prepares the graph text through the mask when there is one, trimmed either way', async () => {
    const mask = jest.fn(async (text: string) => text.replace('Иванов', '[PERSON_1]'));
    const sovereign = new SteeringMailbox({ headMessageId: 'um1', mask });
    await expect(sovereign.prepare('  Иванов не тот  ')).resolves.toBe('[PERSON_1] не тот');
    expect(mask).toHaveBeenCalledWith('Иванов не тот');

    const legacy = new SteeringMailbox({ headMessageId: 'um1' });
    await expect(legacy.prepare('  как есть ')).resolves.toBe('как есть');
  });

  it('REJECTS when masking fails — raw personal data must not reach a passthrough model', async () => {
    const box = new SteeringMailbox({
      headMessageId: 'um1',
      mask: async () => {
        throw new Error('anonymizer down');
      },
    });
    await expect(box.prepare('Иванов')).rejects.toThrow('anonymizer down');
    expect(box.size).toBe(0);
  });
});

describe('steering registry', () => {
  it('finds a registered mailbox by stream id and forgets it only for the same instance', () => {
    const first = new SteeringMailbox({ headMessageId: 'a' });
    const second = new SteeringMailbox({ headMessageId: 'b' });
    registerSteering('stream-x', first);
    expect(getSteering('stream-x')).toBe(first);

    /* A replaced job re-registers under the same id; the old run unwinding
     * afterwards must not pull the new run's mailbox out from under it. */
    registerSteering('stream-x', second);
    unregisterSteering('stream-x', first);
    expect(getSteering('stream-x')).toBe(second);

    unregisterSteering('stream-x', second);
    expect(getSteering('stream-x')).toBeUndefined();
  });
});
