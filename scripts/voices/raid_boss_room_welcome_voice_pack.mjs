import { Buffer } from 'node:buffer';
import { yellKey } from './extra_lines.mjs';
import { IGNIVAR_PRODUCTION_VOICE_PRESET } from './ignivar_robotic_voice_processing.mjs';

export const RAID_BOSS_ROOM_WELCOME_VOICE_LINES = Object.freeze([
  Object.freeze({
    npcId: 'ignivar',
    key: yellKey('The seal hears you, little embers. Step closer, and feed the Last Flame.'),
    text: 'The seal hears you, little embers. Step closer, and feed the Last Flame.',
    synthesisText:
      '[low mechanical whisper] The seal hears you, little embers. Step closer, and feed the Last Flame.',
    processingPreset: IGNIVAR_PRODUCTION_VOICE_PRESET,
  }),
]);

export function decodeRaidBossRoomWelcomeSynthesis(generated, npcId) {
  if (
    typeof generated.audio_base64 !== 'string' ||
    generated.audio_base64.length === 0 ||
    !generated.alignment ||
    typeof generated.alignment !== 'object'
  ) {
    throw new Error(`${npcId} synthesis returned no audio or alignment`);
  }
  const audio = Buffer.from(generated.audio_base64, 'base64');
  if (audio.length === 0) {
    throw new Error(`${npcId} synthesis returned empty audio`);
  }
  return { audio, alignment: generated.alignment };
}
