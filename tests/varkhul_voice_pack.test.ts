import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { yellKey } from '../scripts/voices/extra_lines.mjs';
import {
  normalizeVarkhulAlignmentWords,
  shouldUseVarkhulScribeFallback,
  VARKHUL_VOICE_PACK_LINES,
  validateVarkhulAlignment,
} from '../scripts/voices/varkhul_voice_pack.mjs';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';
import { VARKHUL_DIALOGUE_LINES } from '../src/sim/encounters/varkhul_dialogue';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Varkhul production voice pack', () => {
  it('uses the selected Obsidian Stone-Forge treatment for every live line', () => {
    expect(
      VARKHUL_VOICE_PACK_LINES.map((line: { text: string; processingPreset: string }) => ({
        text: line.text,
        processingPreset: line.processingPreset,
      })),
    ).toEqual(VARKHUL_DIALOGUE_LINES.map((text) => ({ text, processingPreset: 'stone-forge' })));
  });

  it('ships one versioned Varkhul clip for every encounter line', () => {
    for (const text of VARKHUL_DIALOGUE_LINES) {
      const key = yellKey(text);
      expect(
        existsSync(join(repoRoot, 'public', 'audio', 'voice', 'varkhul', `${key}.mp3`)),
        text,
      ).toBe(true);
      expect(VOICE_LINES[key], text).toMatch(
        new RegExp(`^/audio/voice/varkhul/${key}\\.mp3\\?v=[a-f0-9]{12}$`),
      );
    }
  });

  it('keeps Voice Design direction separate from runtime yell keys', () => {
    for (const line of VARKHUL_VOICE_PACK_LINES) {
      expect(line.synthesisText).toContain(line.text);
      expect(line.synthesisText).not.toBe(line.text);
    }
  });

  it('repairs Scribe splitting Forgefather into two timestamped words', () => {
    expect(
      normalizeVarkhulAlignmentWords([
        { text: 'Varkul,', start: 1, end: 1.5 },
        { text: ' ', start: 1.5, end: 1.6, type: 'spacing' },
        { text: 'Forge', start: 1.6, end: 2 },
        { text: ' ', start: 2, end: 2.1, type: 'spacing' },
        { text: 'Father', start: 2.1, end: 2.5 },
      ]),
    ).toEqual([
      { text: 'Varkul,', start: 1, end: 1.5 },
      { text: 'Forgefather', start: 1.6, end: 2.5 },
    ]);
  });

  it('falls back to Scribe only for the forced-alignment permission failure', () => {
    expect(shouldUseVarkhulScribeFallback(401, 'missing forced_alignment permission')).toBe(true);
    expect(shouldUseVarkhulScribeFallback(401, 'invalid api key')).toBe(false);
    expect(shouldUseVarkhulScribeFallback(403, 'missing forced_alignment permission')).toBe(false);
  });

  it('rejects alignment responses without timestamped words', () => {
    const alignment = { words: [{ text: 'Varkhul', start: 0, end: 0.5 }] };
    expect(validateVarkhulAlignment(alignment)).toBe(alignment);
    expect(() => validateVarkhulAlignment({ words: [] })).toThrow(
      'Varkhul alignment returned no words',
    );
    expect(() => validateVarkhulAlignment({})).toThrow('Varkhul alignment returned no words');
  });
});
