import type { OverheadEmoteId } from '../world_api';

export function emoteIconUrl(id: OverheadEmoteId): string {
  return `/ui/emotes/emote-${id}.png`;
}
