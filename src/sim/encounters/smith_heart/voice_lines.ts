// Every line the Smith's Heart's speakers say, with the voice it is spoken in
// (the voice pack's folder under public/audio/voice, scripts/voices/
// voice_ids.json): the one list the voice pipeline renders
// (scripts/render_smith_heart_voice_pack.mjs), the manifest is built from
// (scripts/gen_npc_lines.mjs) and the tests hold against the shipped clips.
// The client finds a clip by the live yell's English (src/ui/hud_voice_cues.ts
// yellVoiceKey), so a reworded line needs its clip rendered again.

import { BREATH_LINES } from './breath_voice';
import { COUNCIL_LINES } from './council_voice';
import { FINAL_LINES } from './final_voice';
import { HEAT_LINES } from './heat_voice';
import { QUENCH_LINES } from './quench_voice';

/** The raid's voices (folder ids). Thessaly keeps the Highwatch captain's. */
export const SMITH_HEART_VOICES = {
  guardian: 'heart_hammer_guardian',
  singer: 'heart_seam_singer',
  breath: 'heart_breath_guardian',
  thessaly: 'captain_thessaly',
  quench: 'heart_quench_guardian',
  heat: 'heart_heat_guardian',
  final: 'heart_masterless_strength',
} as const;

export interface SmithHeartVoiceLine {
  /** The voice folder it is spoken in. */
  voiceNpc: string;
  /** `<speaker>.<moment>`: the line's stable name in the pack. */
  id: string;
  text: string;
}

function rows(
  voiceNpc: string,
  speaker: string,
  lines: Readonly<Partial<Record<string, string>>>,
): SmithHeartVoiceLine[] {
  const out: SmithHeartVoiceLine[] = [];
  for (const [moment, text] of Object.entries(lines)) {
    if (text) out.push({ voiceNpc, id: `${speaker}.${moment}`, text });
  }
  return out;
}

export const SMITH_HEART_VOICE_LINES: readonly SmithHeartVoiceLine[] = [
  ...rows(SMITH_HEART_VOICES.guardian, 'guardian', COUNCIL_LINES.guardian),
  ...rows(SMITH_HEART_VOICES.singer, 'singer', COUNCIL_LINES.singer),
  ...rows(SMITH_HEART_VOICES.breath, 'breath', BREATH_LINES.guardian),
  ...rows(SMITH_HEART_VOICES.thessaly, 'thessaly', BREATH_LINES.thessaly),
  ...rows(SMITH_HEART_VOICES.quench, 'quench', QUENCH_LINES),
  ...rows(SMITH_HEART_VOICES.heat, 'heat', HEAT_LINES),
  ...rows(SMITH_HEART_VOICES.final, 'final', FINAL_LINES),
];
