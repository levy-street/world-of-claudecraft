// Listen-only voice lines in the SFX Studio: the Smith's Heart speakers'
// published clips (public/audio/voice/<speaker>/), grouped one dropdown entry
// per speaker plus the whole raid, so a sound pass can hear the bosses beside
// their mechanics. Voices are NOT Studio cues: they are rendered and published
// by scripts/render_smith_heart_voice_pack.mjs, so the Studio only lists and
// plays them, never edits them.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The raid's speakers in raid order. A `prefix` keeps a speaker who also
 *  talks outside the raid to the raid's own lines. */
export const VOICE_SPEAKERS = Object.freeze(
  [
    { speaker: 'heart_hammer_guardian', label: 'Guardian of the Hammer' },
    { speaker: 'heart_seam_singer', label: 'Seam Singer' },
    { speaker: 'captain_thessaly', label: 'Captain Thessaly', prefix: 'yell__' },
    { speaker: 'heart_breath_guardian', label: 'Guardian of the Breath' },
    { speaker: 'heart_quench_guardian', label: 'Guardian of the Quench' },
    { speaker: 'heart_heat_guardian', label: 'Guardian of the Heat' },
    { speaker: 'heart_masterless_strength', label: 'Masterless Strength' },
  ].map((entry) => Object.freeze(entry)),
);

const SPEAKERS = new Set(VOICE_SPEAKERS.map((entry) => entry.speaker));
export const VOICE_FILE_PATTERN = /^[a-z0-9_]+\.mp3$/;

/** Whether `speaker` is one the Studio may serve voice clips for. */
export function isVoiceSpeaker(speaker) {
  return SPEAKERS.has(speaker);
}

/** A readable title from a clip's file name: the runtime keys a line by its
 *  English (`yell__back_into_the_stone.mp3`), so this is that line again. */
export function voiceLineTitle(fileName) {
  const words = fileName
    .replace(/\.mp3$/, '')
    .replace(/^[a-z]+__/, '')
    .replace(/_/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : fileName;
}

/** Every raid voice clip on disk under `voiceRoot`, and the dropdown groups
 *  (the whole raid first, then each speaker that has lines). */
export function collectVoiceCatalog(voiceRoot) {
  const lines = [];
  for (const { speaker, label, prefix } of VOICE_SPEAKERS) {
    const dir = join(voiceRoot, speaker);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!VOICE_FILE_PATTERN.test(file)) continue;
      if (prefix && !file.startsWith(prefix)) continue;
      lines.push({
        id: `${speaker}/${file}`,
        speaker,
        speakerLabel: label,
        title: voiceLineTitle(file),
        url: `/voice/${speaker}/${file}`,
        bytes: statSync(join(dir, file)).size,
      });
    }
  }
  const groups = [];
  if (lines.length) {
    groups.push({
      id: 'voice_smith_heart',
      label: "Smith's Heart voices: all",
      count: lines.length,
    });
  }
  for (const { speaker, label } of VOICE_SPEAKERS) {
    const count = lines.filter((line) => line.speaker === speaker).length;
    if (count) groups.push({ id: `voice_${speaker}`, label: `Voice: ${label}`, count });
  }
  return { groups, lines };
}

/** Whether a voice line belongs to the dropdown group `groupId`. */
export function voiceLineInGroup(line, groupId) {
  return groupId === 'voice_smith_heart' || groupId === `voice_${line.speaker}`;
}
