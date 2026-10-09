// The Mere Hydra's neck and pour bookkeeping (temple_hydra.ts), as a pure,
// Three-free core: what each neck override is this frame, and which breath
// pours have lost their head.
//
// The Hydra is ONE model whose three necks the renderer overrides after the
// mixer pose (every clip keys all three neck bases, so an override only holds
// while it is re-applied each frame):
//  - a fallen head's neck folds down into the pool; its stump stirs as the
//    regrowth nears;
//  - a regrown head RISES out of the pool: from under the water, full length,
//    straight up (it used to scale the whole chain up from the stump while its
//    fold unwound, a swinging, ballooning arc);
//  - once every head is dead the necks that fell earlier STAY folded while the
//    Death clip takes the last one (without the hold the mixer restored them
//    to full height for a frame, so all three reappeared and died again).
// A pour (the Freezing Breath or the Crushing Torrent's beam) belongs to a
// living head; a pour whose head died, vanished or sank is cut at once (it
// used to keep pouring from the dead head's mouth forever).

/** Seconds a fallen neck takes to fold into the pool. */
export const NECK_FOLD_SECONDS = 1.6;
/** Seconds a regrown neck takes to rise out of the pool. */
export const NECK_RISE_SECONDS = 1.4;
/** Yards a regrowing neck starts under the water. */
export const NECK_RISE_DEPTH = 7;

/** One neck's renderer memory. */
export interface NeckMemory {
  /** 0 standing to 1 folded into the pool. */
  fallen: number;
  /** -1 not rising, else 0 to 1 through the regrowth's rise. */
  rise: number;
  /** The clock when its head fell (-1 while it lives). */
  deadSince: number;
  /** Folded before the last head fell: held folded under the Death clip. */
  held: boolean;
}

export function freshNeck(): NeckMemory {
  return { fallen: 0, rise: -1, deadSince: -1, held: false };
}

/** The override for one neck this frame (null: leave the mixer's pose). */
export interface NeckPose {
  /** Uniform scale of the neck chain from its base. */
  scale: number;
  /** Added to the base bone's x rotation (a fold toward the pool). */
  tiltX: number;
  /** Added to the base bone's z rotation (the stump's writhe). */
  swayZ: number;
  /** Yards the neck base is pushed straight down (under the water). */
  drop: number;
}

export interface NeckInput {
  /** This head is dead. */
  dead: boolean;
  /** Every head is dead (the fight is over; nothing grows back). */
  allDead: boolean;
  /** Seconds a fallen head waits before it regrows. */
  regrowAfter: number;
  clock: number;
  dt: number;
  /** A per-neck phase for the stump's writhe. */
  phase: number;
}

/** Ease out (cubic). */
function easeOut(t: number): number {
  const k = 1 - Math.min(1, Math.max(0, t));
  return 1 - k * k * k;
}

/**
 * Advance one neck's memory and return its pose override. `regrew` is true on
 * the frame a fallen head comes back (the renderer bursts its splash there).
 */
export function stepNeck(
  m: NeckMemory,
  input: NeckInput,
): { pose: NeckPose | null; regrew: boolean } {
  const { dead, allDead, clock, dt } = input;
  if (allDead) {
    // The fight is over: the necks that fell before stay down, the last one
    // is the Death clip's.
    if (!m.held) return { pose: null, regrew: false };
    m.fallen = 1;
    m.rise = -1;
    return { pose: { scale: 0.001, tiltX: 0.8, swayZ: 0, drop: 0 }, regrew: false };
  }
  m.held = false;
  if (dead) {
    if (m.deadSince < 0) m.deadSince = clock;
    m.rise = -1;
    m.fallen = Math.min(1, m.fallen + dt / NECK_FOLD_SECONDS);
    const k = m.fallen;
    const since = clock - m.deadSince;
    const from = input.regrowAfter * 0.55;
    const stir = since > from ? Math.min(1, (since - from) / (input.regrowAfter * 0.45)) : 0;
    return {
      pose: {
        scale: Math.max(0.001, 1 - k * k + stir * 0.3),
        tiltX: k * 0.8 - stir * 0.5,
        swayZ: stir * Math.sin(clock * 9 + input.phase) * 0.25,
        drop: 0,
      },
      regrew: false,
    };
  }
  let regrew = false;
  if (m.deadSince >= 0) {
    // Back from the dead: a folded neck rises out of the pool; one that had
    // barely started to fold simply straightens.
    regrew = m.fallen > 0.5;
    if (regrew) {
      m.rise = 0;
      m.fallen = 0;
    }
    m.deadSince = -1;
  }
  if (m.rise >= 0) {
    m.rise = Math.min(1, m.rise + dt / NECK_RISE_SECONDS);
    const e = easeOut(m.rise);
    const pose = { scale: 0.55 + 0.45 * e, tiltX: 0, swayZ: 0, drop: (1 - e) * NECK_RISE_DEPTH };
    if (m.rise >= 1) m.rise = -1;
    return { pose, regrew };
  }
  if (m.fallen > 0) {
    m.fallen = Math.max(0, m.fallen - dt / (NECK_FOLD_SECONDS * 0.9));
    const k = m.fallen;
    return {
      pose: { scale: Math.max(0.001, 1 - k * k), tiltX: k * 0.8, swayZ: 0, drop: 0 },
      regrew,
    };
  }
  return { pose: null, regrew };
}

/** The last head fell: remember which necks were already folded. */
export function holdFallenNecks(necks: readonly NeckMemory[]): void {
  for (const m of necks) m.held = m.fallen > 0.5;
}

/** A pour slot's owner bookkeeping. */
export interface PourSlot {
  headId: number;
  life: number;
}

/**
 * Cut every pour whose head is no longer a living, surfaced head: it died,
 * left the world, or the body sank under the Tsunami. Returns how many.
 */
export function releaseOrphanPours(
  slots: readonly PourSlot[],
  liveHead: (id: number) => boolean,
): number {
  let n = 0;
  for (const s of slots) {
    if (s.headId < 0 || liveHead(s.headId)) continue;
    s.headId = -1;
    s.life = 0;
    n++;
  }
  return n;
}
