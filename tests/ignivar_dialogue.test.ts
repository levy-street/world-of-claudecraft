import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_DIALOGUE,
  IGNIVAR_DIALOGUE_LINES,
  ignivarDefeatYell,
} from '../src/sim/encounters/ignivar_dialogue';
import { DICT } from '../src/ui/sim_i18n';

describe('Ignivar encounter dialogue', () => {
  it('pins the approved room welcome, four signature lines, and seven supporting lines', () => {
    expect(IGNIVAR_DIALOGUE_LINES).toEqual([
      'The seal hears you, little embers. Step closer, and feed the Last Flame.',
      'Ignivar Ashcaller awakens. Let the world burn!',
      'The sky itself will burn!',
      'The last flame consumes all!',
      'Varkhul... the seal is broken.',
      'Bear the Last Flame. Let it judge you.',
      'The old wells answer to my fire.',
      'Turn with the flame, or be unmade.',
      'Varkhul forged me to endure.',
      'Another spark, extinguished.',
      'The forge rejects you.',
      'I am the seal. I will not break.',
    ]);
    expect(new Set(IGNIVAR_DIALOGUE_LINES).size).toBe(IGNIVAR_DIALOGUE_LINES.length);
  });

  it('alternates the two restrained defeat barks without drawing RNG', () => {
    expect(ignivarDefeatYell(0)).toBe(IGNIVAR_DIALOGUE.defeatSpark);
    expect(ignivarDefeatYell(1)).toBe(IGNIVAR_DIALOGUE.defeatForge);
    expect(ignivarDefeatYell(2)).toBe(IGNIVAR_DIALOGUE.defeatSpark);
  });

  it('fills every new wordy boss line in the five required non-Latin locales', () => {
    const keys = [
      'dialogue.ignivarFinalBrand',
      'dialogue.ignivarConduitActivated',
      'dialogue.ignivarRotatingRays',
      'dialogue.ignivarApocalypse',
      'dialogue.ignivarDefeatSpark',
      'dialogue.ignivarDefeatForge',
      'dialogue.ignivarForgeJudgment',
      'dialogue.ignivarRoomEntry',
      'dialogue.varkhulAssembly',
      'dialogue.varkhulAddsDefeated',
      'dialogue.varkhulEngage',
      'dialogue.varkhulMasterpiece',
    ] as const;
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      for (const key of keys) {
        expect(DICT[language][key], `${language}: ${key}`).not.toBe(DICT.en[key]);
      }
    }
  });
});
