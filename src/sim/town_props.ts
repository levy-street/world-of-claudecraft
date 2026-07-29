// The town's furniture: the profession-station clusters, as sim data so the
// player can actually bump into them.
//
// These objects used to be drawn entirely inside the render layer
// (`stations_core.ts` owned the cluster offsets), which the sim cannot
// import. The result was a real collision gap: solid, waist-to-chest objects
// standing in the starting town that a player walked straight through,
// including anvils, looms, workbenches, barrels and crates that are visually
// identical to the `PROPS.crates` barrels a few yards away that DO block.
// Moving the layout here and letting the renderer read it back is the same
// fix `decoration_dims.ts` applied to rocks: one owner, no drift. (The old
// Artisan Row lived here too until the v0.31 civic rebuild removed its
// renderer placements; collision followed it out.)
//
// SIZES ARE MEASURED from the shipped GLBs (their authored target heights and
// bounding footprints), not guessed. Radii are the mean horizontal half-extent
// trimmed slightly: a forgiving footprint costs a player nothing, while a
// collider taller or wider than its model reads as a bug.
//
// Everything here is standable except open flame, so the whole set is part of
// the traversal ladder: stride the low, vault the mid, climb the tall.

/** Physical size of one piece of town furniture. */
export interface TownPropSize {
  /** Height above its ground (yards). */
  height: number;
  /** Collider radius (yards). */
  r: number;
  /** May a body stand on top? False only for open flame. */
  standable: boolean;
}

export type StationPropKind =
  | 'anvil'
  | 'campfire'
  | 'cauldron'
  | 'tanningRack'
  | 'loom'
  | 'workbench'
  | 'crate'
  | 'barrel';

export const STATION_PROP_SIZES: Readonly<Record<StationPropKind, TownPropSize>> = {
  anvil: { height: 0.75, r: 0.5, standable: true },
  // The station campfire matches the world campfires: a jump clears it, a walk
  // does not, and nobody stands in the fire.
  campfire: { height: 0.45, r: 0.7, standable: false },
  cauldron: { height: 0.9, r: 0.37, standable: true },
  tanningRack: { height: 1.5, r: 0.55, standable: true },
  loom: { height: 1.3, r: 0.72, standable: true },
  workbench: { height: 1.0, r: 0.49, standable: true },
  crate: { height: 0.65, r: 0.31, standable: true },
  barrel: { height: 0.85, r: 0.33, standable: true },
};

export type StationType = 'forge' | 'kitchens' | 'apothecary' | 'tannery' | 'loom' | 'toolworks';

export interface StationClusterProp {
  kind: StationPropKind;
  dx: number;
  dz: number;
  rot: number;
}

// Per-type clusters. The anchor prop stands BESIDE the station point rather
// than on it: the station point is a gameplay interaction target (service
// routes end on it, bodies up to r 0.8 must be able to stand there), and the
// anchor props are SOLID now, so a prop parked on the point would wall off
// the very spot it exists to serve. Each anchor offset clears the point by
// more than ANCHOR_CLEARANCE plus the prop's radius while staying clear of
// the cluster's clutter and the master NPC's side (forge master at station
// -2,-1.5; kitchens -1.5,-1.5; loom -2,-1; toolworks -1.5,-2; tannery
// +2,+1.5; apothecary +1.5,-2).
export const STATION_PROP_CLUSTERS: Readonly<Record<StationType, readonly StationClusterProp[]>> = {
  forge: [
    { kind: 'anvil', dx: 1.4, dz: 0.6, rot: 0.9 },
    { kind: 'barrel', dx: -1.1, dz: 1.0, rot: 0.3 },
    { kind: 'crate', dx: 1.0, dz: -1.2, rot: -0.5 },
  ],
  kitchens: [
    { kind: 'campfire', dx: -1.7, dz: 0.9, rot: 0 },
    { kind: 'crate', dx: 1.2, dz: 0.5, rot: 0.7 },
    { kind: 'barrel', dx: -0.5, dz: 1.4, rot: -0.2 },
  ],
  apothecary: [
    { kind: 'cauldron', dx: 1.5, dz: -0.9, rot: -0.4 },
    { kind: 'crate', dx: -1.3, dz: 0.5, rot: 0.4 },
    { kind: 'barrel', dx: 0.9, dz: 1.2, rot: 0.9 },
  ],
  tannery: [
    { kind: 'tanningRack', dx: -1.0, dz: -1.6, rot: 0.3 },
    { kind: 'barrel', dx: -1.3, dz: 0.7, rot: -0.6 },
    { kind: 'crate', dx: 0.5, dz: -1.4, rot: 1.1 },
  ],
  loom: [
    { kind: 'loom', dx: 0.2, dz: -1.8, rot: 0.6 },
    { kind: 'crate', dx: 1.3, dz: 0.6, rot: -0.3 },
    { kind: 'barrel', dx: 0.4, dz: 1.5, rot: 0.5 },
  ],
  toolworks: [
    { kind: 'workbench', dx: 1.5, dz: 0.6, rot: -0.4 },
    { kind: 'crate', dx: -0.9, dz: 0.4, rot: 0.2 },
    { kind: 'barrel', dx: -1.0, dz: 1.1, rot: -0.8 },
  ],
};

/** One piece of town furniture resolved into world space. */
export interface TownPropPlacement {
  x: number;
  z: number;
  size: TownPropSize;
}

/**
 * Never wall off an NPC. Some station anchors sit at the exact position of
 * their master (the Eastbrook forge and Smith Haldren share a spot, so the
 * anvil is DRAWN inside him): giving that a collider would push players out
 * of talking range of a quest giver. A prop standing on a person is a content
 * overlap to look at, never a wall to enforce.
 */
const NPC_CLEARANCE = 0.4;

/**
 * Never wall off a station anchor either. The anchor point is a gameplay
 * interaction target: service routes end ON it and the town integration
 * contract (tests/eastbrook_gameplay_integration.test.ts) demands a body of
 * any route radius can stand there. The anchor PROP (the anvil, cauldron,
 * campfire drawn at dx 0, dz 0) is therefore scenery, exactly like a prop
 * standing on an NPC; the offset clutter still collides. Clearance covers
 * the widest route body radius (0.8) the contract walks to an anchor.
 */
const ANCHOR_CLEARANCE = 0.85;

function standsOnAnNpc(x: number, z: number, r: number, npcs: readonly TownNpcPos[]): boolean {
  for (const n of npcs) {
    if (Math.hypot(n.x - x, n.z - z) < r + NPC_CLEARANCE) return true;
  }
  return false;
}

function coversAnAnchor(
  x: number,
  z: number,
  r: number,
  anchors: readonly TownStationAnchor[],
): boolean {
  for (const a of anchors) {
    if (Math.hypot(a.x - x, a.z - z) < r + ANCHOR_CLEARANCE) return true;
  }
  return false;
}

export interface TownNpcPos {
  x: number;
  z: number;
}

export interface TownStationAnchor {
  type: string;
  x: number;
  z: number;
}

/**
 * Every collidable piece of town furniture, in world space, with the
 * NPC guard applied. Callers pass the station anchors and the NPC positions
 * so this module stays a pure leaf; `colliders.ts` supplies the live ones and
 * the tests supply the same, which is what keeps the two in agreement.
 */
export function townPropPlacements(
  stations: readonly TownStationAnchor[],
  npcs: readonly TownNpcPos[],
): TownPropPlacement[] {
  const out: TownPropPlacement[] = [];
  for (const st of stations) {
    const cluster = STATION_PROP_CLUSTERS[st.type as StationType];
    if (!cluster) continue;
    for (const prop of cluster) {
      const size = STATION_PROP_SIZES[prop.kind];
      const x = st.x + prop.dx;
      const z = st.z + prop.dz;
      if (standsOnAnNpc(x, z, size.r, npcs)) continue;
      if (coversAnAnchor(x, z, size.r, stations)) continue;
      out.push({ x, z, size });
    }
  }
  return out;
}
