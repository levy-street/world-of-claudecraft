// ---------------------------------------------------------------------------
// Rideable ground mounts: the declarative catalog, shared host-agnostic data.
//
// Used by the authoritative Sim (level gates, the speed/block/crit hooks), the
// renderer (key -> mount GLB visual), and the HUD Mounts window (rows render
// their names/descriptions through the UI's own t() keys, keyed by MountKey).
// It lives in sim/ so it carries no DOM/render imports and runs unchanged on
// the server, offline, and headless.
//
// Every mount is a GROUND mount by design (no flying): the bonus only ever
// scales normal ground/swim locomotion in player_motion.moveSpeedMult.
// ---------------------------------------------------------------------------

export type MountKey =
  | 'grag_bear'
  | 'stalkglider_snail'
  | 'valorsteed'
  | 'aether_hover_cycle'
  | 'shadowjump_toad'
  | 'stormfeather_griffin'
  | 'thunderstrut_gobbler';

export type MountRarity = 'common' | 'rare' | 'epic';

export interface MountDef {
  key: MountKey;
  /** Canonical English display name (the HUD localizes via hudChrome.mounts.*). */
  name: string;
  rarity: MountRarity;
  /** Required player level to select or ride (the card's "Mount Level"). */
  level: number;
  /** Additive move-speed fraction while mounted (0.6 = +60% extra mobility). */
  moveSpeedPct: number;
}

// Speed/stat tiers (design directive): the purchasable horse is the 60% base;
// the loot-only specials tier above it (70% commons, 75% rares with a little
// crit, the 80% epics, the griffin and the gobbler, with the most block and
// crit). The horse's level gate (20) matches the stablemaster's buy gate; the
// loot commons ride earlier (10), the rares at 15, the epics at 20.
export const MOUNTS: Record<MountKey, MountDef> = {
  // The base mount: first in the catalog, the natural default pick, sold by the
  // stablemaster (the only purchasable mount). Level 20 to match the buy gate.
  valorsteed: {
    key: 'valorsteed',
    name: 'Valorsteed',
    rarity: 'common',
    level: 20,
    moveSpeedPct: 0.6,
  },
  grag_bear: {
    key: 'grag_bear',
    name: 'Goliath Grag-Bear',
    rarity: 'common',
    level: 10,
    moveSpeedPct: 0.7,
  },
  stalkglider_snail: {
    key: 'stalkglider_snail',
    name: 'Moss-Shell Stalk-Glider',
    rarity: 'common',
    level: 10,
    moveSpeedPct: 0.7,
  },
  aether_hover_cycle: {
    key: 'aether_hover_cycle',
    name: 'Aether-Jouster Hover-Cycle',
    rarity: 'rare',
    level: 15,
    moveSpeedPct: 0.75,
  },
  shadowjump_toad: {
    key: 'shadowjump_toad',
    name: 'Kama-Kage the Shadow-Jump Toad',
    rarity: 'rare',
    level: 15,
    moveSpeedPct: 0.75,
  },
  stormfeather_griffin: {
    key: 'stormfeather_griffin',
    name: 'Sky-Reach Stormfeather',
    rarity: 'epic',
    level: 20,
    moveSpeedPct: 0.8,
  },
  thunderstrut_gobbler: {
    key: 'thunderstrut_gobbler',
    name: 'Thunderstrut the Grand Gobbler',
    rarity: 'epic',
    level: 20,
    moveSpeedPct: 0.8,
  },
};

/** Catalog order for the mount picker: level tier, then declaration order. */
export const MOUNT_KEYS = Object.keys(MOUNTS) as readonly MountKey[];

/** The horse: the default stable pick and the fallback for every unknown/legacy
 *  persisted value. It is no longer free (a fresh player owns nothing): owning
 *  it means holding its reins item (reins_valorsteed), sold by the stablemaster.
 *  A persisted pick may name a mount the player does not own, which is harmless:
 *  toggleMount falls back to the first owned mount. */
export const DEFAULT_MOUNT: MountKey = 'valorsteed';

/** The steed the riding lesson lends the player. It is the same catalog mount
 *  reins_valorsteed eventually grants, ridden UNOWNED during the lesson (the one
 *  sanctioned unowned mount; see src/sim/mounts.ts). Shared by src/sim/mounts.ts
 *  (the summon special-case) and src/sim/mounts_training.ts. */
export const TRAINING_MOUNT_KEY: MountKey = 'valorsteed';

export function mountDef(key: string): MountDef | null {
  return (MOUNTS as Record<string, MountDef | undefined>)[key] ?? null;
}

/** Coerce a persisted/wire string back to a valid catalog key ('' when unknown,
 *  so a save from a build that removed a mount loads cleanly unmounted). */
export function normalizeMountKey(key: string | undefined | null): MountKey | '' {
  return key && mountDef(key) ? (key as MountKey) : '';
}

/** Coerce a persisted/wire SELECTION to a valid catalog key. Unlike the live
 *  riding state (normalizeMountKey, where '' means dismounted), the stable pick
 *  always names a mount: absent/unknown values fall back to the horse. */
export function normalizeSelectedMount(key: string | undefined | null): MountKey {
  const normalized = normalizeMountKey(key);
  return normalized === '' ? DEFAULT_MOUNT : normalized;
}

/** Additive move-speed fraction of the active mount ('' : 0). */
export function mountMoveSpeedPct(mountKey: string): number {
  return mountKey ? (mountDef(mountKey)?.moveSpeedPct ?? 0) : 0;
}

// ---------------------------------------------------------------------------
// The Galecrest Stables (relocated whole from Highwatch onto the downs
// between the Shear and the Wreckfields): an L-shaped fenced paddock with a
// narrower NORTH horse pasture above the full-width SOUTH open yard, plus
// the ambient stable horses. This is the SINGLE SOURCE OF TRUTH for the
// stable-yard geometry: zone3 content (content/zone3.ts) still defines the
// buildings, Marla, and horse spawns (their ids and saves stay stable) but
// places them at these Galecrest coordinates, and ambient.ts clamps the
// horse wander to it. Keep the numbers here so the fences and horses can
// never drift.
// ---------------------------------------------------------------------------

export interface StablePaddockDef {
  /** Bounding rectangle of the full race yard and pasture (world x/z). */
  x1: number;
  x2: number;
  z1: number;
  z2: number;
  /** The narrower, fully enclosed north pasture extension. */
  pasture: { x1: number };
  /** The one intentional entrance in the race yard's north edge, beside the barn. */
  entrance: { x1: number; x2: number };
  /** The shared z coordinate for the race yard's north edge and pasture divider. */
  divider: { z: number };
}

/** The stable paddock (see the header). Consumed by content/zone3 (fences) and
 *  src/sim/mob/ambient.ts (via STABLE_PASTURE below) as the single source of
 *  truth; do not duplicate these coordinates. Sized so the (enlarged) show-jumping
 *  race ring (MOUNT_RACE_COURSE below) fits south of the divider with clearance.
 *  On the Galecrest downs the rect keeps clear of the rerouted cliff road to
 *  its east, the gale_wisp camp (moved west), and the Shear cliffs. */
export const STABLE_PADDOCK: StablePaddockDef = {
  x1: 330,
  x2: 426,
  z1: 546,
  z2: 606,
  pasture: { x1: 380 },
  entrance: { x1: 360, x2: 370 },
  divider: { z: 588 },
};

/** The paddock terrain plateau: terrainHeight (src/sim/world.ts) blends the ground
 *  toward a single height inside the paddock rect, easing to natural terrain over
 *  `falloff` yards beyond the fence (the Sowfield SOWFIELD_FLAT precedent), so the
 *  course sits on flat, fair ground. Living in terrainHeight means sim collision,
 *  movement, fences, props, and the renderer all agree on the height (the repo's
 *  hard terrain invariant). `height` (4.5) sits just above the rect's natural means
 *  (seed 20061 mean ~3.5, seed 42 mean ~1.1, both spot-checked dry); `falloff` (10) keeps the
 *  apron a gentle slope, not a cliff. Derived from STABLE_PADDOCK so it can never
 *  drift from the shared yard apron. The full bounding rectangle intentionally
 *  stays level so the barn cluster in the open northwest notch is not left on a
 *  different terrain shelf from the race yard and pasture. */
export const STABLE_FLAT = {
  x1: STABLE_PADDOCK.x1,
  x2: STABLE_PADDOCK.x2,
  z1: STABLE_PADDOCK.z1,
  z2: STABLE_PADDOCK.z2,
  height: 4.5,
  falloff: 10,
} as const;

// The ambient horses' wander bound: the narrower pasture extension inset by a
// body-clearance margin and restricted to NORTH of the divider, so a horse never
// leaves the pasture. Derived from STABLE_PADDOCK so nothing carries stale geometry.
const PASTURE_MARGIN = 2;
export const STABLE_PASTURE = {
  xMin: STABLE_PADDOCK.pasture.x1 + PASTURE_MARGIN,
  xMax: STABLE_PADDOCK.x2 - PASTURE_MARGIN,
  zMin: STABLE_PADDOCK.divider.z + PASTURE_MARGIN,
  zMax: STABLE_PADDOCK.z2 - PASTURE_MARGIN,
} as const;

/** Template id of the ambient stable horse (content/zone3 mob def). The
 *  locomotion dispatcher's ambient arm (src/sim/mob/ambient.ts) routes on it. */
export const STABLE_HORSE_TEMPLATE_ID = 'stable_horse';

// ---------------------------------------------------------------------------
// The stables show-jumping race (docs-free minigame, always open): a permanent
// course inside the paddock's south yard. Stand on the glowing platform behind
// the start arch to arm your personal timer, clear every jump in riding order,
// and cross the arch again before the time limit. This block is the SINGLE SOURCE OF TRUTH
// for the course: zone3 content places the arch/jump props from it, the race
// system (src/sim/mount_race.ts) drives gate detection off it, and the client
// racing line + HUD strip derive from it. No coordinate lives anywhere else.
// ---------------------------------------------------------------------------

export type RaceJumpKind = 'vertical' | 'oxer';

/** Shared visual/collision footprint for each jump style. The renderer scales
 *  the GLB to these dimensions and colliders.ts builds the matching jumpable
 *  OBB, so a larger fixture never drifts from its physical footprint. */
export const MOUNT_RACE_JUMP_FIXTURES = {
  vertical: { width: 7.5, depth: 0.8, maxHeight: 1.7 },
  oxer: { width: 8, depth: 1.8, maxHeight: 1.85 },
} as const satisfies Record<RaceJumpKind, { width: number; depth: number; maxHeight: number }>;

/** One gate on the course. `dir` is the RIDING heading through the gate (the
 *  game convention: heading h points at (sin h, cos h) in x/z); the physical
 *  crossbar and the detection segment run perpendicular to it. */
export interface RaceGateDef {
  x: number;
  z: number;
  dir: number;
  kind: RaceJumpKind;
}

export interface MountRaceCourseDef {
  /** The finish arch and authored riding direction. The start action is armed
   *  from MOUNT_RACE_START_PLATFORM behind it; crossing after every jump finishes. */
  arch: { x: number; z: number; dir: number };
  /** Half-width of the arch's crossing segment (world units). */
  archHalfWidth: number;
  /** The jumps in riding order (a clockwise ring from the arch). */
  jumps: readonly RaceGateDef[];
  /** Half-width of a jump's crossing segment (a touch wider than the physical
   *  crossbar, so brushing a post still counts). */
  jumpHalfWidth: number;
  /** Personal time budget from arch to arch. */
  timeLimitSeconds: number;
}

// The ring the course is laid out on: an ellipse centred in the south yard. The
// paddock (x 330..426, south yard z 546..588) gives it a proper arena. Ring x
// spans 342..414, z spans 552..582. Clearances (ring edge to fence): west 12,
// east 12, south 6, divider 6.
const RACE_RING = { cx: 378, cz: 567, rx: 36, rz: 15 } as const;

/** A point + riding tangent on RACE_RING at parameter t (t=0 is the north point,
 *  increasing t rides CLOCKWISE: east along the top first). */
function ringGate(t: number, kind: RaceJumpKind): RaceGateDef {
  const x = RACE_RING.cx + RACE_RING.rx * Math.sin(t);
  const z = RACE_RING.cz + RACE_RING.rz * Math.cos(t);
  // Tangent of (sin t, cos t) parametrisation: (rx*cos t, -rz*sin t).
  const dir = Math.atan2(RACE_RING.rx * Math.cos(t), -RACE_RING.rz * Math.sin(t));
  return { x, z, dir, kind };
}

/** The stables race course: the arch sits east of the ring's north
 *  point and is ridden EASTWARD, then seven jumps circle the arena. */
export const MOUNT_RACE_COURSE: MountRaceCourseDef = {
  arch: { x: 390, z: RACE_RING.cz + RACE_RING.rz, dir: Math.PI / 2 },
  // Half-widths of the crossing segments, sized to the bigger fixtures (props.ts):
  // the ~10yd arch and the 7.5-8yd jumps, each a touch wider than the physical
  // gate so brushing a post still counts.
  archHalfWidth: 5,
  jumps: [
    ringGate(Math.PI / 4, 'vertical'),
    ringGate(Math.PI / 2, 'oxer'),
    ringGate((3 * Math.PI) / 4, 'vertical'),
    ringGate(Math.PI, 'oxer'),
    ringGate((5 * Math.PI) / 4, 'vertical'),
    ringGate((3 * Math.PI) / 2, 'oxer'),
    ringGate((7 * Math.PI) / 4, 'vertical'),
  ],
  jumpHalfWidth: MOUNT_RACE_JUMP_FIXTURES.oxer.width / 2 + 0.35,
  // Arch-to-arch budget for the enlarged lap. Ring perimeter (Ramanujan, rx36 rz15)
  // is ~167yd; a mount runs 7 * 1.6 = 11.2 yd/s, so a clean lap is ~15s of pure
  // travel. The requested 20s budget leaves roughly five seconds for the seven
  // jump set-ups beyond a clean mounted lap, making the event a fast sprint.
  timeLimitSeconds: 20,
};

/** The glowing square a rider stands on to arm the race UI. It sits directly
 *  behind the arch relative to the authored riding direction. Shared by the
 *  renderer, HUD proximity check, and authoritative start validation. */
const START_PLATFORM_BACK_OFFSET = 8;
export const MOUNT_RACE_START_PLATFORM = {
  x: MOUNT_RACE_COURSE.arch.x - Math.sin(MOUNT_RACE_COURSE.arch.dir) * START_PLATFORM_BACK_OFFSET,
  z: MOUNT_RACE_COURSE.arch.z - Math.cos(MOUNT_RACE_COURSE.arch.dir) * START_PLATFORM_BACK_OFFSET,
  size: 8,
} as const;

/** True while a world position is standing within the square start platform. */
export function isOnMountRaceStartPlatform(pos: { x: number; z: number }): boolean {
  const half = MOUNT_RACE_START_PLATFORM.size / 2;
  return (
    Math.abs(pos.x - MOUNT_RACE_START_PLATFORM.x) <= half &&
    Math.abs(pos.z - MOUNT_RACE_START_PLATFORM.z) <= half
  );
}

/** Endpoints of a gate's crossing segment: perpendicular to the riding heading,
 *  centred on the gate. Shared by the race system's segment tests, the prop
 *  placement, and the geometry contract tests. */
export function raceGateSegment(
  gate: { x: number; z: number; dir: number },
  halfWidth: number,
): { ax: number; az: number; bx: number; bz: number } {
  const nx = Math.sin(gate.dir + Math.PI / 2);
  const nz = Math.cos(gate.dir + Math.PI / 2);
  return {
    ax: gate.x - nx * halfWidth,
    az: gate.z - nz * halfWidth,
    bx: gate.x + nx * halfWidth,
    bz: gate.z + nz * halfWidth,
  };
}
