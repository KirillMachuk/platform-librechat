import { readFileSync } from 'fs';
import Tokenizer from '~/utils/tokenizer';

/**
 * What the extraction agent costs per 100 turns, in tokens the tokenizer actually
 * counted rather than an estimate. Memory extraction is one extra model call on
 * every turn, so the per-turn figure is the number that matters, and it has to be
 * stated rather than waved at.
 *
 * Priced at the DeepInfra rate for the pinned extractor model (see the orchestrator
 * plan's model table). Excluded from CI: it prints a measurement, it does not gate.
 *
 *   MEMORY_INSTRUCTIONS_FILE=<path to librechat.yaml> npx jest cost.manual --maxWorkers=1
 */

const INPUT_USD_PER_1M = 0.09;
const OUTPUT_USD_PER_1M = 0.18;
const MESSAGE_WINDOW = 5;

/** A realistic Russian working exchange: the extractor sees the last five messages. */
const DIALOGUE = [
  'Human: Подготовь сравнение условий по двум договорам аренды, которые я загрузил. Мне нужна таблица по срокам, индексации и штрафам.',
  'Assistant: Сравнил оба договора. В таблице ниже — сроки, порядок индексации арендной платы и санкции за просрочку. По второму договору индексация привязана к индексу потребительских цен, по первому — фиксированные 5% в год.',
  'Human: Хорошо. Дальше всегда делай такие сравнения таблицей и добавляй ссылку на пункт договора.',
  'Assistant: Понял, буду приводить сравнения в виде таблицы со ссылками на конкретные пункты.',
  'Human: И ещё: я юрист отдела аренды, мне не нужны общие пояснения про то, что такое договор аренды.',
];

const EXISTING_MEMORY =
  '# Memory Status:\nCurrent memory usage: 180 tokens\nToken limit: 2000 tokens\nRemaining capacity: 1820 tokens\n\n# Existing memory:\n1. [2026-08-03]. ["key": "preferences"] [90 tokens]. ["value": "Отвечать по-русски, кратко, без вводных фраз."]\n\n2. [2026-08-03]. ["key": "context"] [90 tokens]. ["value": "Работает в отделе аренды, ведёт договоры с арендодателями."]';

/** A typical write: one section rewritten in full. */
const TOOL_CALL_OUTPUT =
  '{"key":"preferences","value":"Отвечать по-русски, кратко, без вводных фраз. Сравнения приводить таблицей со ссылками на конкретные пункты договора. Общие пояснения по базовым юридическим понятиям не нужны."}';

function extractorInstructions(): string {
  const configPath = process.env.MEMORY_INSTRUCTIONS_FILE;
  if (!configPath) {
    return '';
  }
  const yaml = readFileSync(configPath, 'utf8');
  const start = yaml.indexOf('    instructions: |');
  if (start === -1) {
    throw new Error('no memory.agent.instructions block in the config');
  }
  const lines = yaml.slice(start).split('\n').slice(1);
  const body: string[] = [];
  for (const line of lines) {
    if (line.trim() !== '' && !line.startsWith('      ')) break;
    body.push(line.trim());
  }
  return body.join('\n');
}

describe('memory extraction cost', () => {
  it('reports what 100 turns of extraction cost', async () => {
    await Tokenizer.initEncoding('o200k_base');
    const count = (text: string) => Tokenizer.getTokenCount(text, 'o200k_base');

    const instructions = extractorInstructions();
    const window = DIALOGUE.slice(-MESSAGE_WINDOW).join('\n');
    const inputTokens = count(instructions) + count(EXISTING_MEMORY) + count(window);
    const outputTokens = count(TOOL_CALL_OUTPUT);

    const per100 =
      ((inputTokens * INPUT_USD_PER_1M + outputTokens * OUTPUT_USD_PER_1M) / 1_000_000) * 100;

    console.log(`\n  инструкция извлекателя: ${count(instructions)} токенов`);
    console.log(`  существующая память:    ${count(EXISTING_MEMORY)} токенов`);
    console.log(`  окно из ${MESSAGE_WINDOW} сообщений:    ${count(window)} токенов`);
    console.log(`  ВХОД на один ход:       ${inputTokens} токенов`);
    console.log(`  ВЫХОД на один ход:      ${outputTokens} токенов (одна запись)`);
    console.log(`  цена 100 ходов:         $${per100.toFixed(4)}`);
    console.log(`  цена 10 000 ходов:      $${(per100 * 100).toFixed(2)}\n`);

    expect(inputTokens).toBeGreaterThan(0);
  }, 60_000);
});
