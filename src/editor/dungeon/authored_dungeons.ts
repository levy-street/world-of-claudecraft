// Registry of the dungeons whose interiors use the authored room-graph seam
// (DungeonLayout.rooms/doors/barriers/decor) and are therefore editable in the
// editor's dungeon mode. Legacy pillar/tomb interiors (crypt, sanctum, temple,
// arena, nythraxis) stay code-authored and are deliberately not listed.
import { DUNGEONS, instanceOrigin } from '../../sim/data';
import type { DungeonLayout } from '../../sim/dungeon_layout';

export interface AuthoredDungeonEntry {
  /** DungeonDef id (sim/data DUNGEONS key). */
  id: string;
  /** DungeonDef.interior key the renderer/collider builders dispatch on. */
  interior: string;
  /** Exported const name in src/sim/dungeon_layout.ts the save endpoint rewrites. */
  constName: string;
  layout: DungeonLayout;
  /** Every decor key that interior's dressing renders: the mode's decor key
   *  picker offers exactly this list, so an authored key never misses its
   *  visual. */
  decorKeys: readonly string[];
}

// Empty today: no shipped dungeon uses the authored room-graph seam, so the
// editor hides its Dungeon entry (app.ts) until one is registered here. A new
// entry also needs its const in vite.config.ts dungeonEditorSavePlugin's
// allowlist.
export const AUTHORED_DUNGEONS: readonly AuthoredDungeonEntry[] = [];

/** Instance-space origin of the first slot of an authored dungeon: where the
 *  editor camera flies and the coordinate frame edits happen in. */
export function authoredDungeonOrigin(entry: AuthoredDungeonEntry): { x: number; z: number } {
  const def = DUNGEONS[entry.id];
  return instanceOrigin(def.index, 0);
}
