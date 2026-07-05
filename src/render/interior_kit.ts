// Shared KayKit interior asset loading for dungeons and delves (v1).
import { ensureDungeonAssets } from './dungeon';

/** Load the dungeon KayKit module pack used by delve interiors in v1. */
export function ensureDelveInteriorKit(): Promise<void> {
  return ensureDungeonAssets();
}
