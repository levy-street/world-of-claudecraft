import type { GatherNodeType } from '../sim/data';

// Pure node-type -> visual lookup, split out of gather_nodes.ts so a Vitest
// can assert coverage against sim/content/gather_nodes.ts without importing
// three.js. Keep this in sync with NODE_ASSET_URL / NODE_FALLBACK_GEOMETRY in
// gather_nodes.ts: every key here must have a matching GLB asset there.
export const NODE_GEOMETRY_KEYS: readonly GatherNodeType[] = ['ore', 'wood', 'herb'];

export const NODE_COLOR: Record<GatherNodeType, number> = {
  ore: 0x8a8f98,
  wood: 0x5b3a21,
  herb: 0x4caf50,
};

export const NODE_Y_OFFSET: Record<GatherNodeType, number> = {
  ore: 0.45,
  wood: 0.9,
  herb: 0.25,
};
