// Varkhul's walk-in staging. Before anyone pulls, the Forgefather works his
// anvil with his back to the door (his spawn IS the work spot); on first
// engage he leaves the anvil, RUNS to the arena center, stands there and
// roars (the PowerUp one-shot), then starts fighting.
// Pure state machine; the encounter module owns positions, movement, events,
// and every mechanic. The staging deliberately never touches ability timers:
// they tick through the run and the roar, so the cast schedule is identical
// to an un-staged pull.

// Covers the roar one-shot (PowerUp, 2.37s) so melee starts as it lands.
export const VARKHUL_ENGAGE_TAUNT_SECONDS = 2.4;
/** Backstop for the run to the arena center: if room dressing ever pins him
 *  mid-run, the roar fires where he stands instead of stalling the fight
 *  forever. The straight run is about 16u at his chase speed (~2s). */
export const VARKHUL_ENGAGE_RUN_TIMEOUT_SECONDS = 8;
/** He runs from his anvil to the middle of the arena (the dais center). */
export const VARKHUL_ENGAGE_ARENA_LOCAL_POS = { x: 0, z: 0 } as const;
/** How close a living player must come to pull him off the anvil. Matches
 *  his template aggroRadius; damage pulls at any range. */
export const VARKHUL_ENGAGE_RADIUS = 30;
/** Pre-pull anvil work cadence; mirrors the assembly-phase forge hammer. */
export const VARKHUL_ENGAGE_HAMMER_FIRST_SECONDS = 0.6;
export const VARKHUL_ENGAGE_HAMMER_EVERY_SECONDS = 2;

export type VarkhulEngagePhase = 'forging' | 'running' | 'taunting' | 'done';

export interface VarkhulEngageState {
  phase: VarkhulEngagePhase;
  /** seconds left: the run timeout while running, the roar while taunting */
  remaining: number;
  /** pre-pull hammer-blow countdown while forging */
  hammerTimer: number;
}

export function initVarkhulEngage(): VarkhulEngageState {
  return {
    phase: 'forging',
    remaining: 0,
    hammerTimer: VARKHUL_ENGAGE_HAMMER_FIRST_SECONDS,
  };
}

/** Pre-pull anvil work: true exactly on the ticks a hammer blow lands. */
export function varkhulForgingHammerTick(st: VarkhulEngageState, dt: number): boolean {
  if (st.phase !== 'forging') return false;
  st.hammerTimer -= dt;
  if (st.hammerTimer > 1e-6) return false;
  st.hammerTimer += VARKHUL_ENGAGE_HAMMER_EVERY_SECONDS;
  return true;
}

/** First engage: leave the anvil work and start the run to the arena center. */
export function startVarkhulEngage(st: VarkhulEngageState): void {
  if (st.phase !== 'forging') return;
  st.phase = 'running';
  st.remaining = VARKHUL_ENGAGE_RUN_TIMEOUT_SECONDS;
}

export interface VarkhulEngageStep {
  phase: VarkhulEngagePhase;
  /** true on the single step the run completes: cue the roar there */
  roar: boolean;
}

/** Advance the run/roar sequence by one tick. `arrivedAtArena` is the
 *  encounter's own reading of the boss position against the arena center;
 *  the machine turns it (or the run timeout) into the one roar edge. */
export function tickVarkhulEngage(
  st: VarkhulEngageState,
  dt: number,
  arrivedAtArena: boolean,
): VarkhulEngageStep {
  if (st.phase === 'running') {
    st.remaining -= dt;
    if (!arrivedAtArena && st.remaining > 1e-6) return { phase: 'running', roar: false };
    st.phase = 'taunting';
    st.remaining = VARKHUL_ENGAGE_TAUNT_SECONDS;
    return { phase: 'taunting', roar: true };
  }
  if (st.phase === 'taunting') {
    st.remaining -= dt;
    if (st.remaining > 1e-6) return { phase: 'taunting', roar: false };
    st.phase = 'done';
    return { phase: 'done', roar: false };
  }
  return { phase: st.phase, roar: false };
}

/** Whether the room's presence actually pulls him off the anvil: someone in
 *  engage range, or any damage already taken. Pure so the encounter's
 *  room-wide auto-target can stay untouched for everything after the pull. */
export function varkhulEngagePulled(
  bossPos: { x: number; z: number },
  bossHpFraction: number,
  playerPositions: readonly { x: number; z: number }[],
): boolean {
  if (bossHpFraction < 1) return true;
  for (const pos of playerPositions) {
    const dx = pos.x - bossPos.x;
    const dz = pos.z - bossPos.z;
    if (dx * dx + dz * dz <= VARKHUL_ENGAGE_RADIUS * VARKHUL_ENGAGE_RADIUS) return true;
  }
  return false;
}
