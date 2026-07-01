import type { OverheadEmoteId } from '../world_api';
import { publicAssetUrl } from '../asset_url';

export function emoteIconUrl(id: OverheadEmoteId): string {
  return publicAssetUrl(`/ui/emotes/emote-${id}.png`);
}
