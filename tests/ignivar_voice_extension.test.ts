import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decodeIgnivarVoiceExtensionSynthesis,
  IGNIVAR_VOICE_EXTENSION_LINES,
  IGNIVAR_VOICE_EXTENSION_MASTER_TEXT,
  IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT,
  ignivarVoiceExtensionMasterText,
  resolveIgnivarVoiceExtensionModel,
  validateFinalizedIgnivarVoiceReceipt,
  validateIgnivarVoiceExtensionCache,
} from '../scripts/voices/ignivar_voice_extension.mjs';

const expectedLines = [
  'Bear the Last Flame. Let it judge you.',
  'The old wells answer to my fire.',
  'Turn with the flame, or be unmade.',
  'Varkhul forged me to endure.',
  'Another spark, extinguished.',
  'The forge rejects you.',
  'I am the seal. I will not break.',
];

describe('Ignivar voice extension', () => {
  it('pins the seven approved lines and stable output names', () => {
    expect(IGNIVAR_VOICE_EXTENSION_LINES.map(({ text }) => text)).toEqual(expectedLines);
    expect(IGNIVAR_VOICE_EXTENSION_LINES.map(({ outputName }) => outputName)).toEqual([
      '01-last-flame-judgment',
      '02-wells-answer',
      '03-turn-with-the-flame',
      '04-varkhul-forged-me',
      '05-another-spark',
      '06-forge-rejects-you',
      '07-seal-will-not-break',
    ]);
  });

  it('keeps every new line once inside one untagged performance with approved anchors', () => {
    expect(IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT).toMatch(
      /^Ignivar Ashcaller awakens\. Let the world burn! /,
    );
    expect(IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT).toMatch(/ Varkhul\.\.\. the seal is broken\.$/);
    expect(IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT).toContain('The sky itself will burn!');
    expect(IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT).toContain('The last flame consumes all!');
    expect(IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT).not.toContain('[');
    expect(IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT).not.toContain(']');
    for (const line of expectedLines) {
      expect(IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT.split(line)).toHaveLength(2);
    }
  });

  it('offers the stable model by default and Eleven v3 as an explicit audition', () => {
    expect(resolveIgnivarVoiceExtensionModel()).toBe('eleven_multilingual_v2');
    expect(resolveIgnivarVoiceExtensionModel('eleven_v3')).toBe('eleven_v3');
    expect(ignivarVoiceExtensionMasterText()).toBe(IGNIVAR_VOICE_EXTENSION_MASTER_TEXT);
    expect(ignivarVoiceExtensionMasterText('eleven_v3')).toBe(
      IGNIVAR_VOICE_EXTENSION_V3_MASTER_TEXT,
    );
    expect(() => resolveIgnivarVoiceExtensionModel('turbo')).toThrow(
      'Unsupported Ignivar voice model: turbo',
    );
  });

  it('requires a finalized Ignivar receipt before synthesis', () => {
    const receipt = { boss: 'ignivar', voiceId: 'voice-1' };
    expect(validateFinalizedIgnivarVoiceReceipt(receipt)).toBe(receipt);
    expect(() =>
      validateFinalizedIgnivarVoiceReceipt({ boss: 'varkhul', voiceId: 'voice-1' }),
    ).toThrow('Receipt does not contain a finalized Ignivar voice');
    expect(() => validateFinalizedIgnivarVoiceReceipt({ boss: 'ignivar' })).toThrow(
      'Receipt does not contain a finalized Ignivar voice',
    );
  });

  it('accepts only complete caches and timestamped synthesis responses', () => {
    expect(() => validateIgnivarVoiceExtensionCache(false, false)).not.toThrow();
    expect(() => validateIgnivarVoiceExtensionCache(true, true)).not.toThrow();
    expect(() => validateIgnivarVoiceExtensionCache(true, false)).toThrow(
      'Incomplete cached synthesis',
    );
    expect(() => validateIgnivarVoiceExtensionCache(false, true)).toThrow(
      'Incomplete cached synthesis',
    );

    const alignment = {
      characters: ['I'],
      character_start_times_seconds: [0],
      character_end_times_seconds: [0.1],
    };
    expect(
      decodeIgnivarVoiceExtensionSynthesis({
        audio_base64: Buffer.from('voice').toString('base64'),
        alignment,
      }),
    ).toEqual({ audio: Buffer.from('voice'), alignment });
    expect(() => decodeIgnivarVoiceExtensionSynthesis({ alignment })).toThrow(
      'Voice synthesis returned no audio or character alignment',
    );
    expect(() => decodeIgnivarVoiceExtensionSynthesis({ audio_base64: 'dm9pY2U=' })).toThrow(
      'Voice synthesis returned no audio or character alignment',
    );
    expect(() =>
      decodeIgnivarVoiceExtensionSynthesis({
        audio_base64: 'dm9pY2U=',
        alignment: {
          characters: ['I'],
          character_start_times_seconds: [0],
          character_end_times_seconds: [],
        },
      }),
    ).toThrow('Voice synthesis alignment arrays must have equal lengths');
  });
});
