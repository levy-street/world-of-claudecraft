import type { VoiceFade, VoicePlayOptions } from '../game/voice';
import { SMITH_HEART_VOICE_LINES } from '../sim/encounters/smith_heart/voice_lines';

export interface VoicedYellState {
  key: string;
  atMs: number;
}

export const VOICED_YELL_DEDUPE_MS = 500;
export const NYTHRAXIS_VOICE_GAIN = 1.25;

export function nextVoicedYell(
  previous: VoicedYellState | null,
  key: string,
  atMs: number,
): { play: boolean; state: VoicedYellState } {
  const state = { key, atMs };
  if (previous && previous.key === key && atMs - previous.atMs < VOICED_YELL_DEDUPE_MS) {
    return { play: false, state: previous };
  }
  return { play: true, state };
}

export function voicedYellGain(from: string): number {
  return from.startsWith('Nythraxis') ? NYTHRAXIS_VOICE_GAIN : 1;
}

// The Smith's Heart's voiced lines (src/sim/encounters/smith_heart/
// voice_lines.ts): mastered at -15 LUFS and played a touch over unity, they
// sit over the raid's -14 LUFS boss score (played at 0.6 of the music slider,
// src/game/music.ts applyBossPlayback); a raid line waits for the one before
// it instead of cutting it off (a boss's death and Thessaly's cheer share a
// tick); and each fades with its speaker's distance over a raid arena's span
// (positional), never silent inside the fight's own room.
export const SMITH_HEART_VOICE_GAIN = 1.2;
/** Full volume within the first radius (yards), silent at the second. */
export const SMITH_HEART_VOICE_FADE: VoiceFade = [45, 160];

const SMITH_HEART_TEXTS: ReadonlySet<string> = new Set(SMITH_HEART_VOICE_LINES.map((l) => l.text));

/** How a voiced yell plays: its gain, whether it queues behind a playing raid
 *  line, and its distance fade (null: none, it plays at full wherever the
 *  listener stands, as every yell outside the raid always has). */
export interface VoicedYellMix {
  play: VoicePlayOptions;
  fade: VoiceFade | null;
}

export function voicedYellMix(from: string, text: string): VoicedYellMix {
  if (SMITH_HEART_TEXTS.has(text)) {
    return { play: { gain: SMITH_HEART_VOICE_GAIN, queue: true }, fade: SMITH_HEART_VOICE_FADE };
  }
  return { play: { gain: voicedYellGain(from) }, fade: null };
}
