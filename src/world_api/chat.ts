import type { OverheadEmoteId } from '../sim/types';

export const OVERHEAD_EMOTES = [
  { id: 'wave', label: 'Wave' },
  { id: 'laugh', label: 'LOL' },
  { id: 'question', label: 'Bro?' },
  { id: 'cheer', label: 'Cheer' },
  { id: 'dance', label: 'Dance' },
  { id: 'point', label: 'Point' },
  { id: 'flex', label: 'Flex' },
  { id: 'salute', label: 'Salute' },
  { id: 'cry', label: 'Cry' },
  { id: 'bow', label: 'Bow' },
  { id: 'clap', label: 'Clap' },
  { id: 'roar', label: 'Roar' },
  { id: 'kneel', label: 'Kneel' },
] as const satisfies readonly { id: OverheadEmoteId; label: string }[];

// Sourced from the local OVERHEAD_EMOTES (not sim/types' OVERHEAD_EMOTE_IDS): the
// IWorld seam imports sim/ for TYPES only, so the runtime id set is derived here
// instead of value-importing the sim's array.
const OVERHEAD_EMOTE_ID_SET: ReadonlySet<string> = new Set(OVERHEAD_EMOTES.map((e) => e.id));

export function isOverheadEmoteId(value: unknown): value is OverheadEmoteId {
  return typeof value === 'string' && OVERHEAD_EMOTE_ID_SET.has(value);
}

export interface IWorldChat {
  chat(text: string): void;
  playEmote(emoteId: OverheadEmoteId): void;
}
