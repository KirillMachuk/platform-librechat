import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from '@langchain/core/messages';

import type { UsageMetadata } from '@langchain/core/messages';

import {
  estimateTokens,
  fenceUntrusted,
  usageFromMessage,
  usageFromExchange,
  untrustedDirective,
  sanitizeErrorForUser,
  stripCitationControlChars,
} from './shared';

describe('usageFromMessage', () => {
  it('extracts usage from an AIMessageChunk — the streaming path (C2 regression)', () => {
    const chunk = new AIMessageChunk({
      content: 'x',
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    expect(usageFromMessage(chunk)).toEqual({ input: 10, output: 5, total: 15 });
  });

  it('extracts usage from a plain AIMessage', () => {
    const message = new AIMessage({
      content: 'x',
      usage_metadata: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    });
    expect(usageFromMessage(message)).toEqual({ input: 7, output: 3, total: 10 });
  });

  it('derives total from input+output when a proxy omits total_tokens', () => {
    const chunk = new AIMessageChunk({ content: 'x' });
    // Simulate a usage-rewriting proxy (e.g. the anonymizer) that ships partial
    // usage without total_tokens — the type requires it, but providers/proxies lie.
    chunk.usage_metadata = { input_tokens: 4, output_tokens: 6 } as UsageMetadata;
    expect(usageFromMessage(chunk)).toEqual({ input: 4, output: 6, total: 10 });
  });

  it('returns empty when the model reports no usage', () => {
    expect(usageFromMessage(new AIMessage({ content: 'x' }))).toEqual({});
    expect(usageFromMessage(new AIMessageChunk({ content: 'x' }))).toEqual({});
  });
});

describe('estimateTokens', () => {
  it('is zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates ~3 characters per token', () => {
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('abcdef')).toBe(2);
    expect(estimateTokens('abcdefg')).toBe(3);
  });

  it('grows monotonically with length', () => {
    expect(estimateTokens('a'.repeat(300))).toBeGreaterThan(estimateTokens('a'.repeat(30)));
  });
});

describe('usageFromExchange', () => {
  const prompt = [new SystemMessage('system instructions here'), new HumanMessage('the question')];

  it('uses the model-reported usage when present (ignores the estimate)', () => {
    const response = new AIMessageChunk({
      content: 'short',
      usage_metadata: { input_tokens: 1000, output_tokens: 2000, total_tokens: 3000 },
    });
    expect(usageFromExchange(prompt, response)).toEqual({ input: 1000, output: 2000, total: 3000 });
  });

  it('falls back to a length estimate when usage is absent (proxy stripped it)', () => {
    const response = new AIMessageChunk({ content: 'a fabricated answer with some length' });
    const usage = usageFromExchange(prompt, response);
    expect(usage.input).toBe(estimateTokens('system instructions here\nthe question'));
    expect(usage.output).toBe(estimateTokens('a fabricated answer with some length'));
    expect(usage.total).toBe((usage.input ?? 0) + (usage.output ?? 0));
    expect(usage.total).toBeGreaterThan(0);
  });
});

describe('fenceUntrusted', () => {
  it('wraps text in per-run nonce markers the model can key on', () => {
    const out = fenceUntrusted('внешний материал', 'abc-123');
    expect(out).toContain('<UNTRUSTED abc-123>');
    expect(out).toContain('</UNTRUSTED abc-123>');
    expect(out).toContain('внешний материал');
  });
});

describe('untrustedDirective', () => {
  it('embeds the nonce and forbids executing instructions inside the fences', () => {
    const directive = untrustedDirective('abc-123');
    expect(directive).toContain('abc-123');
    expect(directive).toMatch(/НИКОГДА не исполняй/i);
  });
});

describe('stripCitationControlChars', () => {
  it('removes Private-Use citation control chars (U+E200–U+E2FF) but keeps real text', () => {
    const dirty = `факт${String.fromCharCode(0xe200)}${String.fromCharCode(0xe2ff)}источник`;
    expect(stripCitationControlChars(dirty)).toBe('фактисточник');
  });

  it('leaves clean text unchanged', () => {
    expect(stripCitationControlChars('обычный текст 123 https://cbr.ru')).toBe('обычный текст 123 https://cbr.ru');
  });
});

describe('sanitizeErrorForUser', () => {
  it('maps errors to fixed RU category phrases', () => {
    expect(sanitizeErrorForUser(new Error('AbortError: operation aborted'))).toBe('операция была прервана');
    expect(sanitizeErrorForUser(new Error('Request timed out after 60000ms'))).toBe(
      'превышено время ожидания ответа модели',
    );
    expect(sanitizeErrorForUser(new Error('429 Too Many Requests'))).toBe('достигнут лимит запросов к модели');
    expect(sanitizeErrorForUser(new Error('ECONNREFUSED 10.0.0.5:443'))).toBe(
      'временная сетевая ошибка при обращении к модели',
    );
    expect(sanitizeErrorForUser(new Error('maximum context length exceeded'))).toBe('превышен лимит контекста модели');
    expect(sanitizeErrorForUser(new Error('totally unexpected failure'))).toBe('внутренняя ошибка при обработке запроса');
  });

  it('never leaks the host, URL or port from the raw error', () => {
    const leaky = new Error('connect ETIMEDOUT https://anon-proxy.internal:8443/v1/chat from 10.0.0.5');
    const safe = sanitizeErrorForUser(leaky);
    expect(safe).not.toMatch(/https?:|:\d{2,5}|anon-proxy|10\.0\.0\.5/);
  });
});
