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
