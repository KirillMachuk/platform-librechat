const { getPreliminaryUserMessage } = require('./request');

describe('getPreliminaryUserMessage (DR turn shape)', () => {
  const conversationId = 'convo-1';

  it('builds the user message from body ids on a fresh turn', () => {
    const message = getPreliminaryUserMessage(
      { messageId: 'u-new', parentMessageId: 'p-0', text: 'вопрос' },
      conversationId,
    );
    expect(message).toEqual({
      messageId: 'u-new',
      parentMessageId: 'p-0',
      conversationId,
      text: 'вопрос',
      sender: 'User',
      isCreatedByUser: true,
    });
  });

  it('REGENERATE reuses the EXISTING user message id (overrideParentMessageId), not the placeholder', () => {
    // Stock client (useChatFunctions): on regenerate body.messageId is a fresh v4
    // placeholder while overrideParentMessageId carries the original user message id.
    // Building from the placeholder saved a duplicate user sibling (live bug: user
    // bubble "disappeared" behind a 2/2 switcher after regenerating a plan card).
    const message = getPreliminaryUserMessage(
      {
        messageId: 'placeholder-v4',
        parentMessageId: 'p-0',
        text: 'вопрос',
        isRegenerate: true,
        overrideParentMessageId: 'u-original',
      },
      conversationId,
    );
    expect(message?.messageId).toBe('u-original');
    expect(message?.parentMessageId).toBe('p-0');
  });

  it('REGENERATE falls back to body.messageId when override is absent (defensive)', () => {
    const message = getPreliminaryUserMessage(
      { messageId: 'u-x', parentMessageId: 'p-0', text: 't', isRegenerate: true },
      conversationId,
    );
    expect(message?.messageId).toBe('u-x');
  });

  it('returns null without a usable id', () => {
    expect(getPreliminaryUserMessage({ text: 't' }, conversationId)).toBeNull();
    expect(getPreliminaryUserMessage({ messageId: '' }, conversationId)).toBeNull();
  });
});
