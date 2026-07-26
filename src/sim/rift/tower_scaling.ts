// The Demon Tower difficulty curve: one pure function of the floor index.
//
// The tower is a TEN-floor raid ascent, and its whole design promise is that
// every floor is harder than the one below it. That promise is a property of
// this module: the multipliers are GEOMETRIC in the floor index, so monotonicity
// is guaranteed by construction rather than by a hand-maintained table somebody
// can typo into a flat step (pinned by tests/demon_tower_scaling.test.ts).
//
// Where the anchors come from: floor 1 sits at the untuned rift baseline (x1.0,
// the C-rank stat line) and floor 10 lands beyond the S-rank heroic rung, so the
// climb spans the whole existing rift difficulty ladder and then goes past its
// top. Reference points in rift/ranks.ts RIFT_HEROIC_TUNING: A is hp x1.9 /
// damage x1.6, heroic S is hp x5.0 / damage x4.0. The steps below put floor 5
// just past A and floor 10 past heroic S on BOTH axes.
//
// The tower is TEN-player raid content while the heroic rift ladder is tuned for
// five, so the health curve deliberately outruns the damage curve: double the
// raid is double the damage output, and the summit has to survive it. Floor 10
// lands near 2x heroic S health but only ~1.2x its damage, because a one-shot
// wall is not difficulty, it is a coin flip.
//
// Pure leaf: no SimContext, no rng, no state. A Vitest imports it directly.

/** Floors in the tower. Ten, as the design calls for; every consumer reads this. */
export const DEMON_TOWER_FLOOR_COUNT = 10;

// Per-floor compounding, applied as step^floorIndex. Over the nine steps from
// floor 1 to floor 10 that is health x10.6, damage x4.8, adds x2.4, armor x2.0.
const HEALTH_STEP = 1.3;
const DAMAGE_STEP = 1.19;
// Summoned adds land on top of a boss's own output, so they take a softer curve
// (the heroic addDamageMultiplier precedent in rift/ranks.ts).
const ADD_DAMAGE_STEP = 1.1;
const ARMOR_STEP = 1.08;

/** Hard ceiling on demons alive at once, whatever the wave maths asks for. Ten
 * raiders plus a boss plus its adds already load the server tick; an unbounded
 * pack size on floor 10 would turn the climax into a spawn storm. The wave
 * driver holds the rest of the wave back until the floor drops under this. */
export const DEMON_TOWER_MAX_LIVE_DEMONS = 24;

export interface DemonTowerFloorTuning {
  /** 1-based floor number as players see it ("Floor 7"). */
  floor: number;
  healthMultiplier: number;
  damageMultiplier: number;
  addDamageMultiplier: number;
  armorMultiplier: number;
  /** How many waves this floor sends before its ascent opens. */
  waveCount: number;
  /** Demons in each of those waves. */
  packSize: number;
  /** How many entries of a boss template's rankMechanics list run here. The
   * budget widens as you climb, so the two bosses show more of their kit up
   * top (mirrors RIFT_RANK_MECHANIC_BUDGET). */
  mechanicLimit: number;
}

/** Clamp a caller's floor index into the tower. */
export function clampTowerFloorIndex(floorIndex: number): number {
  if (!Number.isFinite(floorIndex)) return 0;
  return Math.max(0, Math.min(DEMON_TOWER_FLOOR_COUNT - 1, Math.floor(floorIndex)));
}

/** Every knob the tower scales, for one floor. `floorIndex` is 0-based. */
export function demonTowerFloorTuning(floorIndex: number): DemonTowerFloorTuning {
  const k = clampTowerFloorIndex(floorIndex);
  return {
    floor: k + 1,
    healthMultiplier: round4(HEALTH_STEP ** k),
    damageMultiplier: round4(DAMAGE_STEP ** k),
    addDamageMultiplier: round4(ADD_DAMAGE_STEP ** k),
    armorMultiplier: round4(ARMOR_STEP ** k),
    // 3 waves at the bottom, 7 at the top: the floor gets longer as well as harder.
    waveCount: 3 + Math.floor(k / 2),
    // 5 demons a wave at the bottom, 14 at the top (still under the live cap, so
    // a full pack always lands in one go until the boss floors add their own).
    packSize: 5 + k,
    // C-rank equivalent at the bottom, the full four-mechanic kit from floor 7 up.
    mechanicLimit: 1 + Math.floor(k / 3),
  };
}

/** A boss floor: the mid-tower gatekeeper and the Demon Lord at the summit.
 * Boss floors run their waves FIRST and then release the boss, so the fight is
 * earned rather than a door you walk through. */
export function isDemonTowerBossFloor(floorIndex: number): boolean {
  const k = clampTowerFloorIndex(floorIndex);
  return DEMON_TOWER_BOSS_FLOORS.has(k);
}

/** 0-based floors that release a boss: 3, 5, 7 and the summit as players count
 * them. Kept here (not in tower_waves) so the scaling curve and the wave plan
 * read the same set without a cycle. */
export const DEMON_TOWER_BOSS_FLOORS: ReadonlySet<number> = new Set([2, 4, 6, 9]);

/** Collision radius of the Demon Core standing at the centre of every arena.
 * MEASURED from the built GLB by the asset pipeline's prop lane (job
 * `demon_core`, footprint r 2.74 at its shipped 6-yard height), so what the raid
 * bumps into is what it sees; the wave ring is placed clear of it. */
export const DEMON_TOWER_CORE_RADIUS = 2.74;

/** The arena TIGHTENS as you climb (34 yards at the base, 22 at the summit), so
 * the same pack size reads as more pressure without needing more demons. Pure so
 * the sim's collision shell and the renderer's floor disc agree exactly. */
export function demonTowerArenaRadius(floorIndex: number): number {
  const k = clampTowerFloorIndex(floorIndex);
  return 34 - k * (12 / (DEMON_TOWER_FLOOR_COUNT - 1));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
