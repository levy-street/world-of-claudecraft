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

/** Whether the Studio may list and serve `file` for `speaker`: an allowlisted
 *  speaker, a plain lowercase mp3 name, and the speaker's raid prefix if it has
 *  one (Captain Thessaly also talks outside the raid). The catalog and the
 *  /voice/ route both ask this, so the route serves exactly what is listed. */
export function isVoiceFile(speaker, file) {
  const entry = VOICE_SPEAKERS.find((candidate) => candidate.speaker === speaker);
  if (!entry || !VOICE_FILE_PATTERN.test(file)) return false;
  return !entry.prefix || file.startsWith(entry.prefix);
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
  for (const { speaker, label } of VOICE_SPEAKERS) {
    const dir = join(voiceRoot, speaker);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!isVoiceFile(speaker, file)) continue;
      lines.push({
        id: `${speaker}/${file}`,
        speaker,
        speakerLabel: label,
        title: voiceLineTitle(file),
        url: `/voice/${speaker}/${file}`,
        bytes: statSync(join(dir, file)).size,
        groups: ['voice_smith_heart', `voice_${speaker}`],
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

/** Whether a voice line belongs to the dropdown group `groupId` (the Studio
 *  page filters on the same `groups` list the catalog sends). */
export function voiceLineInGroup(line, groupId) {
  return line.groups.includes(groupId);
}
