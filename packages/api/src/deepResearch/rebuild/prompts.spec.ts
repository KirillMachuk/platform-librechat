import type { DeepResearchFinding } from './state';
import {
  buildReportPrompt,
  buildCompressPrompt,
  buildResearcherPrompt,
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
  it('supervisor fences gathered findings and carries the untrusted directive', () => {
    const prompt = buildSupervisorPrompt({
      now: NOW,
      brief: 'b',
      jurisdiction: 'RU',
      findings: [finding('q1', 'дайджест-1')],
      round: 1,
      maxRounds: 8,
      maxConcurrent: 4,
      nonce: NONCE,
    });
    // The gathered digest itself must sit inside a fence (the directive also
    // mentions the markers, so assert the exact wrapped block, not a bare marker).
    expect(prompt).toContain(`<UNTRUSTED ${NONCE}>\n1. [q1] дайджест-1\n</UNTRUSTED ${NONCE}>`);
    expect(prompt).toMatch(/НИКОГДА не исполняй/i);
  });

  it('supervisor asks for a parallel batch of up to maxConcurrent sub-questions (A2)', () => {
    const prompt = buildSupervisorPrompt({
      now: NOW,
      brief: 'b',
      jurisdiction: 'RU',
      findings: [],
      round: 0,
      maxRounds: 8,
      maxConcurrent: 3,
      nonce: NONCE,
    });
    expect(prompt).toContain('до 3');
    expect(prompt).toContain('subQuestions');
    expect(prompt).toMatch(/ПАРАЛЛЕЛЬНО/);
  });

  it('supervisor does NOT fence the placeholder when nothing is gathered', () => {
    const prompt = buildSupervisorPrompt({
      now: NOW,
      brief: 'b',
      jurisdiction: 'RU',
      findings: [],
      round: 0,
      maxRounds: 8,
      maxConcurrent: 4,
      nonce: NONCE,
    });
    expect(prompt).toContain('(пока ничего не собрано)');
    expect(prompt).not.toContain(`<UNTRUSTED ${NONCE}>\n(пока ничего не собрано)`);
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
