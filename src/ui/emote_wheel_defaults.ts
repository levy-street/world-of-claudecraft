// The emote wheel's slot rules, shared by the HUD's wheel editor and its
// saved-slot loader: how many emotes the wheel holds, and the wheel a player
// starts with (or falls back to when the saved one is empty or corrupt).

import type { OverheadEmoteId } from '../world_api';

export const EMOTE_WHEEL_LIMIT = 8;
export const DEFAULT_EMOTE_WHEEL: readonly OverheadEmoteId[] = [
  'wave',
  'laugh',
  'question',
  'cheer',
  'dance',
  'point',
  'flex',
  'cry',
];
