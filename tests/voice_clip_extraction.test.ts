import { describe, expect, it } from 'vitest';
import {
  phraseCharacterClipBounds,
  phraseClipBounds,
  shouldUseScribeFallback,
  validateCharacterAlignment,
  validateWordAlignment,
} from '../scripts/voices/voice_clip_extraction.mjs';

const words = [
  { text: 'Ignivar', start: 0.1, end: 0.5 },
  { text: 'Ashcaller', start: 0.55, end: 1.0 },
  { text: 'awakens.', start: 1.05, end: 1.5 },
  { text: 'Let', start: 1.75, end: 1.9 },
  { text: 'the', start: 1.95, end: 2.05 },
  { text: 'world', start: 2.1, end: 2.4 },
  { text: 'burn!', start: 2.45, end: 2.8 },
  { text: 'The', start: 3.3, end: 3.45 },
  { text: 'sky', start: 3.5, end: 3.75 },
  { text: 'itself', start: 3.8, end: 4.1 },
  { text: 'will', start: 4.15, end: 4.3 },
  { text: 'burn!', start: 4.35, end: 4.75 },
  { text: 'I', start: 5.0, end: 5.05 },
];

describe('voice clip extraction', () => {
  it('finds a punctuation-insensitive phrase and preserves nearby silence', () => {
    expect(phraseClipBounds(words, 'The sky itself will burn!')).toEqual({
      start: 3.22,
      end: 4.87,
    });
  });

  it('never lets padding consume a neighboring spoken word', () => {
    expect(phraseClipBounds(words, 'Ignivar Ashcaller awakens.', { lead: 0.2, tail: 0.4 })).toEqual(
      {
        start: 0,
        end: 1.75,
      },
    );
  });

  it('fails loudly when alignment cannot locate the requested line', () => {
    expect(() => phraseClipBounds(words, 'Varkhul, the seal is broken.')).toThrow(
      'Aligned phrase was not found',
    );
  });

  it('ignores spacing tokens and accepts explicit fantasy-name aliases', () => {
    const scribeWords = [
      { text: 'Ignavar', start: 0.1, end: 0.7, type: 'word' },
      { text: ' ', start: 0.7, end: 0.9, type: 'spacing' },
      { text: 'Ashcaller', start: 0.9, end: 1.6, type: 'word' },
      { text: ' ', start: 1.6, end: 1.8, type: 'spacing' },
      { text: 'awakens.', start: 1.8, end: 2.7, type: 'word' },
    ];

    expect(
      phraseClipBounds(scribeWords, 'Ignivar Ashcaller awakens.', {
        aliases: { ignivar: ['ignavar'] },
      }),
    ).toEqual({ start: 0.02, end: 2.82 });
  });

  it('cuts exact phrases from ElevenLabs character timing without consuming adjacent speech', () => {
    const text = 'Anchor. Bear the Last Flame. Let it judge you. Next.';
    const characters = [...text];
    const alignment = {
      characters,
      character_start_times_seconds: characters.map((_, index) => index * 0.04),
      character_end_times_seconds: characters.map((_, index) => index * 0.04 + 0.03),
    };

    expect(phraseCharacterClipBounds(alignment, 'Bear the Last Flame. Let it judge you.')).toEqual({
      start: 0.27,
      end: 1.88,
    });
  });

  it('fails loudly when character alignment arrays are inconsistent', () => {
    expect(() =>
      phraseCharacterClipBounds(
        {
          characters: ['O', 'K'],
          character_start_times_seconds: [0],
          character_end_times_seconds: [0.1, 0.2],
        },
        'OK',
      ),
    ).toThrow('Character alignment arrays must have equal lengths');
  });

  it('uses Scribe only for forced-alignment permission errors and requires words', () => {
    expect(shouldUseScribeFallback(401, 'missing forced_alignment permission')).toBe(true);
    expect(shouldUseScribeFallback(401, 'invalid api key')).toBe(false);
    expect(shouldUseScribeFallback(500, 'forced_alignment unavailable')).toBe(false);

    const alignment = { words };
    expect(validateWordAlignment(alignment, 'Forced alignment')).toBe(alignment);
    expect(() => validateWordAlignment({ words: [] }, 'Forced alignment')).toThrow(
      'Forced alignment returned no words',
    );
    expect(() => validateWordAlignment({}, 'Forced alignment')).toThrow(
      'Forced alignment returned no words',
    );
    expect(() =>
      validateWordAlignment({ words: [{ text: 'Ignivar', start: 0 }] }, 'Forced alignment'),
    ).toThrow('Forced alignment word 1 has invalid timestamps');
    expect(() =>
      validateWordAlignment(
        { words: [{ text: 'Ignivar', start: 1, end: 0.5 }] },
        'Forced alignment',
      ),
    ).toThrow('Forced alignment word 1 has invalid timestamps');
    for (const word of [
      { text: 7, start: 0, end: 0.5 },
      { text: 'Ignivar', start: Number.NaN, end: 0.5 },
      { text: 'Ignivar', start: -0.1, end: 0.5 },
    ]) {
      expect(() => validateWordAlignment({ words: [word] }, 'Forced alignment')).toThrow(
        'Forced alignment word 1 has invalid timestamps',
      );
    }
  });

  it('validates every character timestamp before extraction or caching', () => {
    const alignment = {
      characters: ['O', 'K'],
      character_start_times_seconds: [0, 0.1],
      character_end_times_seconds: [0.08, 0.2],
    };
    expect(validateCharacterAlignment(alignment)).toBe(alignment);
    expect(() =>
      validateCharacterAlignment({
        ...alignment,
        character_end_times_seconds: [0.08],
      }),
    ).toThrow('Character alignment arrays must have equal lengths');
    expect(() =>
      validateCharacterAlignment({
        ...alignment,
        character_start_times_seconds: [0, Number.NaN],
      }),
    ).toThrow('Character alignment entry 2 has invalid timestamps');
    expect(() => validateCharacterAlignment({})).toThrow(
      'Character alignment must contain characters, start times, and end times',
    );
    expect(() =>
      validateCharacterAlignment({
        characters: [],
        character_start_times_seconds: [],
        character_end_times_seconds: [],
      }),
    ).toThrow('Character alignment returned no character timings');
    for (const invalid of [
      { ...alignment, characters: ['O', 7] },
      { ...alignment, character_start_times_seconds: [0, -0.1] },
      { ...alignment, character_end_times_seconds: [0.08, 0.05] },
    ]) {
      expect(() => validateCharacterAlignment(invalid)).toThrow(
        'Character alignment entry 2 has invalid timestamps',
      );
    }
  });
});
