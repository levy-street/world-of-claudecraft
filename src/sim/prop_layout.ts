import { hash2 } from './rng';

// Layout and size of the SUB-PROPS that dress the world's composite props:
// the clutter around a market stall, the ore cart at a mine, the headstones in
// a graveyard. Plain data, shared by `src/sim/colliders.ts` (which turns it
// into collision) and `src/render/props.ts` (which places the models), exactly
// as `dungeon_layout.ts` is shared for interiors, so what you see and what you
// bump into cannot drift apart.
//
// Why this file had to exist: these objects were drawn as loose children of a
// parent group and never existed in the collision set at all, so a player
// walked straight through the anvils, barrels, carts, and every headstone in
// the graveyard. They are all waist-to-chest height, which is precisely the
// range a player expects to vault, mount, or be stopped by.
//
// HEIGHTS ARE MEASURED, not guessed: each `height` below is the shipped GLB's
// own bounding height multiplied by the scale the renderer places it at (the
// GLB paths are in `src/render/props.ts` `PROP_ASSET_DEFS`). Radii are the
// model's mean horizontal half-extent, trimmed slightly, because a forgiving
// footprint costs a player nothing while a too-tall collider reads as a bug.

/** One dressing prop, positioned in its parent's LOCAL frame (yards). */
export interface SubProp {
  /** Local offset from the parent prop's origin, before the parent's yaw. */
  x: number;
  z: number;
  /** Collider radius (yards). */
  r: number;
  /** Height above the parent's ground (yards). */
  height: number;
  /** Placement scale the renderer applies to the model. */
  scale: number;
}

// ---------------------------------------------------------------------------
// Market stall dressing (parent: PROPS.stalls, rotated by the stall's yaw)
// ---------------------------------------------------------------------------

/** Forge front: anvil and weapon rack (stalls flagged `smithy`). */
export const SMITHY_DRESSING: readonly SubProp[] = [
  // anvil.glb: 0.556 tall natively, placed at 1.35
  { x: 1.35, z: 1.15, r: 0.55, height: 0.75, scale: 1.35 },
  // weapon_stand.glb: 1.109 tall natively, placed at 1.25
  { x: -1.45, z: 0.6, r: 0.68, height: 1.39, scale: 1.25 },
];

/** Produce stall: an apple crate and a barrel (every non-smithy stall). */
export const STALL_DRESSING: readonly SubProp[] = [
  // farmcrate_apple.glb: 0.244 tall natively, placed at 1.5
  { x: 1.3, z: 1.05, r: 0.45, height: 0.37, scale: 1.5 },
  // barrel.glb: 0.898 tall natively, placed at 1.15
  { x: -1.35, z: 0.85, r: 0.4, height: 1.03, scale: 1.15 },
];

// ---------------------------------------------------------------------------
// Mine dressing (parent: PROPS.mines, unrotated local offsets)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dock dressing (parent: PROPS.docks, local offsets rotated by the dock rot)
// ---------------------------------------------------------------------------
// Loose barrels and a crate around the pier ENTRY and the hut, deliberately
// OFF the plank walkway (issue #1500 pins the deck as crossable in a straight
// line), all collidable and standable. The single source both render/props.ts
// and colliders.ts consume, exactly like STALL_DRESSING.
export const DOCK_DRESSING: readonly SubProp[] = [
  // barrel.glb 0.898 native, placed at 0.95: west of the pier entry, ashore.
  { x: -1.8, z: 1.3, r: 0.38, height: 0.85, scale: 0.95 },
  // barrel.glb at 1.15: beside the pier throat, against the hut's corner.
  { x: 1.45, z: 0.9, r: 0.4, height: 1.03, scale: 1.15 },
  // crate_wooden.glb 0.931 native at 0.9: behind the hut on the shore.
  { x: 0.55, z: 4.6, r: 0.6, height: 0.84, scale: 0.9 },
];

/** The moored rowboat beside the pier tip: a stridable deck you can step
 *  into. Local offset/heading; afloat-vs-beached is decided at the waterline
 *  (the same predicate the renderer seats the mesh with). */
export const DOCK_BOAT = {
  x: 3.1,
  z: -5.6,
  rot: 0.35,
  // rowboat.glb hull at the placed 0.85 scale: ~2.3 long, ~0.9 across the
  // beam (the raw bounds include the shipped oars; the hull is what a body
  // meets). Deck sits just under the 0.72 gunwale, so a body stands IN it.
  hw: 1.15,
  hd: 0.45,
  deckHeight: 0.4,
} as const;

// ---------------------------------------------------------------------------
// Chapel composition (parent: PROPS.buildings kind 'chapel')
// ---------------------------------------------------------------------------
// The chapel is COMPOSED: a tall bell tower at the rear plus a squat stone
// entry hall in front. These numbers are the single source for BOTH the
// renderer's part placement (src/render/props.ts) and the compound collider
// (src/sim/colliders.ts): the tower stays a full-height wall, the hall roof
// is a standable, climbable low roof section.
export const CHAPEL_TOWER = {
  /** local z offset of the tower's centre */
  dz: -0.75,
  /** tower footprint as fractions of the building's w/d */
  wScale: 0.98,
  dScale: 0.72,
  /** visual height the tower asset is scaled to */
  height: 10.6,
} as const;
export const CHAPEL_HALL = {
  /** the hall's centre sits this far back from the footprint's front edge */
  dzFromFront: 1.62,
  /** hall width as a fraction of the building's w */
  wScale: 0.9,
  /** visual height the hall asset is scaled to */
  height: 2.5,
  /** hall depth in yards (absolute, not a fraction) */
  depth: 3.2,
  /** buildings sink this far into the ground (render group y offset) */
  sink: 0.12,
} as const;
/** The hall roof's standable ridge above its ground: height minus the sink. */
export const CHAPEL_HALL_ROOF_TOP = CHAPEL_HALL.height - CHAPEL_HALL.sink;
/** The hall roof's eave height: house_3's measured eave line sits at 60.5
 *  percent of its height (walls below, roof above), scaled to 2.5 and sunk. */
export const CHAPEL_HALL_ROOF_EAVE = 1.39;

// ---------------------------------------------------------------------------
// Camp crates (parent: PROPS.crates entries, one prop per point)
// ---------------------------------------------------------------------------
// The renderer draws every third camp "crate" as a barrel, and jitters the
// wooden crates' scale per point. These are the SAME rolls the renderer
// draws (its propRand), so the collider always matches the mesh actually
// placed: kind, footprint, and top height per point.

/** The renderer's per-prop placement roll (props.ts propRand), shared. */
export function propPlacementRoll(x: number, z: number, n: number): number {
  return hash2(Math.round(x * 37), Math.round(z * 37) + n * 7919, 0x517cc1);
}

/** Physical shape of the i-th camp crate at (x, z): barrel or wooden crate,
 *  with the measured GLB extents at the exact per-point render scale. */
export function campCrateShape(x: number, z: number, index: number): { r: number; top: number } {
  if (index % 3 === 2) {
    // barrel.glb: 0.898 tall, 0.70 wide, placed at 1.25.
    return { r: 0.44, top: 1.13 };
  }
  // crate_wooden.glb: top face at 0.878, ~0.88 wide, scale 1.3 + roll * 0.15.
  const s = 1.3 + propPlacementRoll(x, z, 5) * 0.15;
  return { r: 0.44 * s, top: 0.878 * s };
}

/** The ore cart parked at a mine mouth. Tall enough to want climbing. */
export const MINE_CART: SubProp = {
  // cart.glb: 0.927 tall natively, placed at 1.9
  x: 2.8,
  z: 1.6,
  r: 0.62,
  height: 1.76,
  scale: 1.9,
};

// ---------------------------------------------------------------------------
// Graveyards (parent: PROPS.graveyards, unrotated grid of six stones)
// ---------------------------------------------------------------------------

/** Stones per graveyard, and the grid they sit on. */
export const GRAVE_COUNT = 6;
export const GRAVE_STRIDE_X = 2.2;
export const GRAVE_STRIDE_Z = 2.6;
/**
 * Placement scale. The renderer jitters this by up to +/-0.25 for variety;
 * collision uses the mean, which the radius comfortably covers.
 */
export const GRAVE_SCALE = 2.25;
/**
 * Native heights of the four headstone models, in the order the renderer
 * cycles them. Every tier draws all four shapes (render/props.ts): graphics
 * settings are gameplay-neutral, so what blocks a player must not depend on
 * their preset, and the drawn shape must be the one whose height blocks.
 */
export const GRAVE_NATIVE_HEIGHTS: readonly number[] = [
  0.575, // gravestone_round
  0.915, // gravestone_cross (the tall one)
  0.529, // gravestone_bevel
  0.594, // gravestone_decorative
];
/** Headstone collider radius (they are thin slabs; keep it forgiving). */
export const GRAVE_RADIUS = 0.42;

/** World height of the i-th headstone in a graveyard. */
export function graveHeight(i: number): number {
  return GRAVE_NATIVE_HEIGHTS[i % GRAVE_NATIVE_HEIGHTS.length] * GRAVE_SCALE;
}

/** Local grid offset of the i-th headstone. */
export function graveOffset(i: number): { x: number; z: number } {
  return { x: (i % 3) * GRAVE_STRIDE_X, z: Math.floor(i / 3) * GRAVE_STRIDE_Z };
}

// ---------------------------------------------------------------------------
// Eastbrook civic rebuild furniture (v0.31): measured drawn geometry for the
// authored OBB placements the rebuild renders through eastbrook_town.ts.
// ---------------------------------------------------------------------------

/**
 * bench.glb native bounding proportions, measured from the shipped GLB
 * (dequantized accessor bounds x node transforms): height and depth as
 * fractions of the native width. The rebuild renderer scales a bench
 * uniformly by min(width / nativeX, depth / nativeZ) and lets the height
 * follow (eastbrook_town.ts), so the drawn seat height is a pure function of
 * the authored footprint. For the civic 1.8 x 0.6 benches this lands at 0.40.
 */
export const BENCH_NATIVE_HEIGHT_PER_WIDTH = 0.28568;
export const BENCH_NATIVE_DEPTH_PER_WIDTH = 0.42851;

/** Drawn top of an authored bench footprint (yards above its ground). */
export function benchDrawnHeight(w: number, d: number): number {
  return BENCH_NATIVE_HEIGHT_PER_WIDTH * Math.min(w, d / BENCH_NATIVE_DEPTH_PER_WIDTH);
}

// ---------------------------------------------------------------------------
// Interactable landmarks (v0.31 walk-through sweep): the solid bodies the
// renderer draws for doors, delve portals, gather nodes, and the Ravenpost
// mailbox, measured from the shipped GLBs at their placed scales. One owner:
// the renderer reads these back where it places the meshes, so the drawn
// silhouette and the collider cannot drift apart.
// ---------------------------------------------------------------------------

/**
 * The overworld dungeon door arch (dungeon_door_arch.glb, drawn at world
 * scale, opening rotated to face +-z). Only the two stone JAMBS collide: the
 * mouth stays open because walking INTO the door is the enter trigger
 * (DOOR_TRIGGER_RADIUS), and the 5yd crown is out of climb reach, so the
 * jambs are plain full-height walls.
 */
export const DOOR_ARCH_JAMB_X = 1.5; // jamb centreline (|local x|)
export const DOOR_ARCH_JAMB_HW = 0.35;
export const DOOR_ARCH_JAMB_HD = 0.56;
export const DOOR_ARCH_HEIGHT = 5;

/**
 * The delve entrance portal (delve_entrance_2.glb, native 1.584 x 2.01 x 0.42,
 * drawn at scale 3.6, base rebased to the ground). It reads as a solid
 * one-way threshold (players enter by talking to the warden, never by
 * walking in), so the WHOLE slab collides, backing plane included. The mouth
 * sign mirrors the renderer: the drowned shrine faces -z, every other delve
 * faces +z, and the arch stands mouth-side of the marker by ARCH_OFFSET.
 */
export const DELVE_ARCH_SCALE = 3.6;
export const DELVE_ARCH_OFFSET = 4;
export const DELVE_ARCH_HW = (1.584 * DELVE_ARCH_SCALE) / 2;
export const DELVE_ARCH_HD = (0.42 * DELVE_ARCH_SCALE) / 2;
export const DELVE_ARCH_HEIGHT = 2.01 * DELVE_ARCH_SCALE;

/** The renderer's mouth-facing sign for a delve door (see render/props.ts). */
export function delveArchMouthSign(delveId: string): number {
  return delveId === 'drowned_litany' ? -1 : 1;
}

/** World z of a delve's arch slab centre (the marker sits mouth-side of it). */
export function delveArchZ(markerZ: number, delveId: string): number {
  return markerZ - delveArchMouthSign(delveId) * DELVE_ARCH_OFFSET;
}

/**
 * Gather nodes (render/gather_nodes.ts draws the GLB at native scale plus a
 * per-type Y offset). Ore veins and wood piles are solid standable rocks and
 * stacks; herb clusters are soft vegetation and deliberately keep no
 * collider, the same exception as marsh reeds. Radii are the mean horizontal
 * half-extent, lightly trimmed; tops are offset + native max y.
 */
export const GATHER_NODE_BODIES: Readonly<Record<string, { r: number; top: number } | null>> = {
  ore: { r: 0.44, top: 0.45 + 0.39 },
  wood: { r: 0.42, top: 0.9 + 0.31 },
  herb: null,
};

/**
 * The Ravenpost mailbox pillar (mailbox_pillar.glb, drawn based at ground,
 * 2.9 tall). The lower body measures 1.36 x 0.9; the raven crown overhangs
 * wider up top, and a sculpture is not a platform, so the shaft is a
 * full-height OBB (the wells rule again).
 */
export const MAILBOX_HW = 0.66;
export const MAILBOX_HD = 0.44;

/**
 * Where leaving a delve seats the body: mouth-side of the arch slab, just
 * clear of its collider, on the warden's side. Shared by delves/runs.ts (the
 * exit and spirit-release drops) so the drop can never land inside the
 * arch's solid slab.
 */
export function delveExitDropZ(markerZ: number, delveId: string): number {
  return delveArchZ(markerZ, delveId) + delveArchMouthSign(delveId) * (DELVE_ARCH_HD + 1.2);
}

/**
 * The Eastbrook town wall wing (eastbrook_wall_wing.glb), measured from the
 * exporter factory (scripts/assets/eastbrook_town/furniture.js) at its native
 * 6.35 x 3.51 bounds, drawn scaled to each segment's length x height. The
 * wing is NOT a solid curtain: it is a stone parapet (slab plus coping) with
 * an open iron railing above and two pillars, a short capped one and a tall
 * lantern pylon. Physics follows that silhouette: the parapet is a standable
 * top a jump vaults onto or clean over (the railing is see-through iron, the
 * fence rule), the short pillar cap is a standable step above it, and only
 * the lantern pylon is a full-height blocker. Fractions of the AUTHORED
 * height / half-length so they survive any segment size.
 */
export const TOWN_WALL_PARAPET_FRAC = 1.81 / 3.51;
export const TOWN_WALL_SHORT_PILLAR_TOP_FRAC = 2.15 / 3.51;
/** Pillar centreline offsets as fractions of the wing's half-length; the
 *  TALL pylon rides +x on an unmirrored wing and flips with `mirrored`. */
export const TOWN_WALL_TALL_PILLAR_ALONG = 2.62 / 3.175;
export const TOWN_WALL_SHORT_PILLAR_ALONG = -2.9 / 3.175;
/** Pillar half-width as a fraction of the wing's native length. */
export const TOWN_WALL_PILLAR_HW_FRAC = 0.36 / 6.35;
