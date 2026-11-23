// Worker cache identities belong to the pool, not the authored simulation data.
// Object identity keeps two independently editable copies from sharing a cache
// entry, even when a clone carries the original record's runtime fields.
import type { TerrainCut } from '../sim/types';

export function createVoxelIdentityRegistry(): (cut: TerrainCut) => { vid: string; vrev: number } {
  const ids = new WeakMap<TerrainCut, string>();
  let nextId = 1;
  return (cut) => {
    let vid = ids.get(cut);
    if (!vid) {
      vid = `v${nextId++}`;
      ids.set(cut, vid);
    }
    return { vid, vrev: cut.vrev ?? 0 };
  };
}
