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

// Tier differentiation in the 3D world (the UX pass): a node's tier was
// tooltip-only, so a tier-3 vein read identical to the tier-1 beside it
// until hovered. One uniform scale step per tier above 1: SIZE, never hue
// (the color-independence rule), and static on every graphics preset (tier
// is actionable info, the fairness invariant; nothing here may read
// ui_effects_profile or the governor).
export const NODE_TIER_SCALE_STEP = 0.18;

/** The uniform prop scale for a node tier (tier 1 = 1; floors at 1). */
export function nodeTierScale(tier: number): number {
  return 1 + NODE_TIER_SCALE_STEP * (Math.max(1, tier) - 1);
}
