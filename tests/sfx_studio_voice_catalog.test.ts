// The SFX Studio's listen-only voice view (scripts/sfx_studio/voice_catalog.mjs):
// which published clips it lists, how it titles and groups them. The route that
// serves them is pinned in tests/sfx_studio_server_security.test.ts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectVoiceCatalog,
  isVoiceFile,
  isVoiceSpeaker,
  VOICE_SPEAKERS,
  voiceLineInGroup,
  voiceLineTitle,
} from '../scripts/sfx_studio/voice_catalog.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('SFX Studio voice catalog', () => {
  it('titles a line from its runtime key', () => {
    expect(voiceLineTitle('yell__back_into_the_stone.mp3')).toBe('Back into the stone');
    expect(voiceLineTitle('greeting__smith_haldren.mp3')).toBe('Smith haldren');
  });

  it("lists only allowlisted speakers, mp3 names, and a prefixed speaker's raid lines", () => {
    const root = mkdtempSync(join(tmpdir(), 'wocc-voice-catalog-'));
    try {
      const write = (speaker: string, file: string) => {
        mkdirSync(join(root, speaker), { recursive: true });
        writeFileSync(join(root, speaker, file), 'x');
      };
      write('heart_masterless_strength', 'yell__one_body.mp3');
      write('heart_masterless_strength', 'notes.txt');
      write('heart_masterless_strength', 'Bad Name.mp3');
      write('captain_thessaly', 'yell__hold_the_line.mp3');
      write('captain_thessaly', 'greeting__captain_thessaly.mp3');
      write('ignivar', 'yell__not_the_raid.mp3');
      const { groups, lines } = collectVoiceCatalog(root);
      expect(lines.map((line) => line.id)).toEqual([
        'captain_thessaly/yell__hold_the_line.mp3',
        'heart_masterless_strength/yell__one_body.mp3',
      ]);
      expect(lines[1]).toMatchObject({
        speakerLabel: 'Masterless Strength',
        title: 'One body',
        url: '/voice/heart_masterless_strength/yell__one_body.mp3',
        bytes: 1,
      });
      expect(groups).toEqual([
        { id: 'voice_smith_heart', label: "Smith's Heart voices: all", count: 2 },
        { id: 'voice_captain_thessaly', label: 'Voice: Captain Thessaly', count: 1 },
        { id: 'voice_heart_masterless_strength', label: 'Voice: Masterless Strength', count: 1 },
      ]);
      expect(isVoiceSpeaker('ignivar')).toBe(false);
      expect(isVoiceSpeaker('heart_masterless_strength')).toBe(true);
      // The one rule the catalog and the /voice/ route share.
      expect(isVoiceFile('heart_masterless_strength', 'yell__one_body.mp3')).toBe(true);
      expect(isVoiceFile('captain_thessaly', 'yell__hold_the_line.mp3')).toBe(true);
      expect(isVoiceFile('captain_thessaly', 'greeting__captain_thessaly.mp3')).toBe(false);
      expect(isVoiceFile('heart_masterless_strength', 'Bad Name.mp3')).toBe(false);
      expect(isVoiceFile('heart_masterless_strength', 'notes.txt')).toBe(false);
      expect(isVoiceFile('ignivar', 'yell__not_the_raid.mp3')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds every raid speaker on the real tree, the whole raid first', () => {
    const { groups, lines } = collectVoiceCatalog(join(ROOT, 'public/audio/voice'));
    expect(groups.map((group) => group.id)).toEqual([
      'voice_smith_heart',
      ...VOICE_SPEAKERS.map((entry) => `voice_${entry.speaker}`),
    ]);
    expect(groups[0]?.count).toBe(lines.length);
    expect(lines.length).toBeGreaterThanOrEqual(100);
    for (const line of lines.filter((entry) => entry.speaker === 'captain_thessaly'))
      expect(line.id).toMatch(/^captain_thessaly\/yell__/);
    const masterless = lines.find((line) => line.speaker === 'heart_masterless_strength');
    expect(masterless && voiceLineInGroup(masterless, 'voice_heart_masterless_strength')).toBe(
      true,
    );
    expect(masterless && voiceLineInGroup(masterless, 'voice_smith_heart')).toBe(true);
    expect(masterless && voiceLineInGroup(masterless, 'voice_heart_heat_guardian')).toBe(false);
  });
});
