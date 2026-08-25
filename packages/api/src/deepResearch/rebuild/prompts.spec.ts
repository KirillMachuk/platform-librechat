import type { DeepResearchFinding } from './state';
import {
  buildReportPrompt,
  buildCompressPrompt,
  buildResearcherPrompt,
  buildSupervisorInput,
  buildSupervisorPrompt,
} from './prompts';

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'nonce-xyz';

const finding = (subQuestion: string, digest: string): DeepResearchFinding => ({
  round: 1,
  subQuestion,
  digest,
  sources: [],
  tokens: 10,
});

describe('prompt spotlighting (H5)', () => {
  it('supervisor fences gathered findings — now in the HUMAN half, where they live', () => {
    // The digests moved out of the system message with the system/human split; the fence
    // moved with them and must still wrap them. Asserting only on the system prompt would
    // now pass while the untrusted text rode unfenced in the other message.
    const input = buildSupervisorInput({
      brief: 'b',
      findings: [finding('q1', 'дайджест-1')],
      round: 1,
      maxRounds: 8,
      nonce: NONCE,
    });
    // The gathered digest itself must sit inside a fence (the directive also
    // mentions the markers, so assert the exact wrapped block, not a bare marker).
    expect(input).toContain(`<UNTRUSTED ${NONCE}>\n1. [q1] дайджест-1\n</UNTRUSTED ${NONCE}>`);
  });

  it('supervisor RULES still carry the untrusted directive, and no foreign text', () => {
    const prompt = buildSupervisorPrompt({
      now: NOW,
      jurisdiction: 'RU',
      maxConcurrent: 4,
      nonce: NONCE,
    });
    expect(prompt).toMatch(/НИКОГДА не исполняй/i);
    // The directive claims the task and format are set by THIS system message; that claim
    // is only true while no gathered third-party text shares the message with it.
    expect(prompt).not.toContain('дайджест-1');
  });

  it('supervisor asks for a parallel batch of up to maxConcurrent sub-questions (A2)', () => {
    const prompt = buildSupervisorPrompt({
      now: NOW,
      jurisdiction: 'RU',
      maxConcurrent: 3,
      nonce: NONCE,
    });
    expect(prompt).toContain('до 3');
    expect(prompt).toContain('subQuestions');
    expect(prompt).toMatch(/ПАРАЛЛЕЛЬНО/);
  });

  it('supervisor does NOT fence the placeholder when nothing is gathered', () => {
    const input = buildSupervisorInput({
      brief: 'b',
      findings: [],
      round: 0,
      maxRounds: 8,
      nonce: NONCE,
    });
    expect(input).toContain('(пока ничего не собрано)');
    expect(input).not.toContain(`<UNTRUSTED ${NONCE}>\n(пока ничего не собрано)`);
  });

  it('supervisor input carries the brief and the round counter the rules refer to', () => {
    const input = buildSupervisorInput({
      brief: 'бриф про рынок СЭД',
      findings: [],
      round: 2,
      maxRounds: 6,
      nonce: NONCE,
    });
    expect(input).toContain('бриф про рынок СЭД');
    expect(input).toContain('выполнено раундов: 2 из 6');
  });

  it('researcher, compress and report all carry the untrusted directive with the nonce', () => {
    const prompts = [
      buildResearcherPrompt({
        subQuestion: 'q',
        jurisdiction: 'RU',
        now: NOW,
        maxTurns: 5,
        nonce: NONCE,
      }),
      buildCompressPrompt({
        subQuestion: 'q',
        jurisdiction: 'RU',
        digestCap: 800,
        now: NOW,
        nonce: NONCE,
      }),
      buildReportPrompt({ request: 'q', brief: 'b', jurisdiction: 'RU', now: NOW, nonce: NONCE }),
    ];
    for (const prompt of prompts) {
      expect(prompt).toContain(NONCE);
      expect(prompt).toMatch(/НИКОГДА не исполняй/i);
    }
  });
});

describe('search + report quality prompts (C2, D1)', () => {
  it('researcher prompt steers to targeted queries and authoritative RU sources (C2)', () => {
    const prompt = buildResearcherPrompt({
      subQuestion: 'q',
      jurisdiction: 'RU',
      now: NOW,
      maxTurns: 5,
      nonce: NONCE,
    });
    expect(prompt).toMatch(/TAdviser|CNews/);
    expect(prompt).toMatch(/листикл/i);
    expect(prompt).toMatch(/ТОЧНЫЕ запросы/);
  });

  it('report prompt mandates a comparison table + recommendation, and forbids a PII memo header (D1)', () => {
    const prompt = buildReportPrompt({
      request: 'q',
      brief: 'b',
      jurisdiction: 'RU',
      now: NOW,
      nonce: NONCE,
    });
    expect(prompt).toMatch(/ТАБЛИЦУ СРАВНЕНИЯ/);
    expect(prompt).toMatch(/ОБЯЗАТЕЛЬНО/);
    expect(prompt).toMatch(/\| Критерий \| Вариант А \| Вариант Б \|/);
    expect(prompt).toMatch(/Рекомендация/);
    expect(prompt).toMatch(/допущения/);
    expect(prompt).toMatch(/НЕ добавляй шапку/);
    expect(prompt).not.toMatch(/АНАЛИТИЧЕСКУЮ ЗАПИСКУ/);
  });
});

describe('what the supervisor is given to decide on', () => {
  /**
   * Findings used to be cut to 300 characters each before the supervisor saw them — about
   * one sentence of a digest. The node whose whole job is to notice what is still missing
   * was choosing the next round from a headline per sub-question. The digest is already
   * the compressed form (`digestCap` bounds it where it is produced), so a second cut here
   * bounded nothing and cost the decision its evidence.
   */
  it('shows the whole digest, not its first sentence', () => {
    const digest = `начало-дайджеста ${'я'.repeat(600)} конец-дайджеста`;

    const input = buildSupervisorInput({
      brief: 'b',
      findings: [finding('q1', digest)],
      round: 1,
      maxRounds: 8,
      nonce: NONCE,
    });

    expect(input).toContain('начало-дайджеста');
    expect(input).toContain('конец-дайджеста');
  });
});

describe('what COMPRESS is asked for', () => {
  it('states the cap as a ceiling and forbids padding to reach it', () => {
    const prompt = buildCompressPrompt({
      subQuestion: 'q',
      jurisdiction: 'RU',
      digestCap: 6000,
      now: NOW,
      nonce: NONCE,
    });

    expect(prompt).toContain('6000 символов');
    expect(prompt).toContain('потолок, а не норма');
    expect(prompt).toContain('Ничего не добавляй ради объёма');
  });
});
