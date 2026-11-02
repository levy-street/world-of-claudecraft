// Wraith the Deadstrier's flame tail hangs and swings like hair: a short chain of
// points in world space, each pulled toward where the rigid tail would put it
// (its goal, carried by the tail bone) and held to its neighbour's distance, so
// it lags behind a turn, flicks after a stop and swings with the gallop's own
// tail motion. Pure math on flat arrays (no three.js), stepped once per frame
// by ossuary_flames.ts, which turns each point's distance from its goal into
// the bend the tail tongues draw with.

/** Points along the tail, root (pinned to its goal) to tip. */
export const TAIL_LINKS = 5;

export interface TailChainState {
  /** World position per link, xyz interleaved. */
  pos: Float32Array;
  /** Last frame's positions (Verlet velocity). */
  prev: Float32Array;
  primed: boolean;
}

export interface TailChainTuning {
  /** Pull toward the goal at the root and at the tip, per second: stiff near
   *  the body, loose toward the tip. */
  stiffRoot: number;
  stiffTip: number;
  /** Velocity kept per 1/60 s. */
  damping: number;
  /** Downward acceleration, world units per second squared. */
  gravity: number;
}

/** The damping doubles as air drag: at a gallop it holds the tip back about
 *  a twentieth of the ground speed behind the rigid tail, so the tail streams. */
export const TAIL_TUNING: TailChainTuning = {
  stiffRoot: 25,
  stiffTip: 3.5,
  damping: 0.82,
  gravity: 4,
};

/** Longest step integrated at once; longer frames are split. */
const MAX_STEP_S = 1 / 30;

export function createTailChain(): TailChainState {
  return {
    pos: new Float32Array(TAIL_LINKS * 3),
    prev: new Float32Array(TAIL_LINKS * 3),
    primed: false,
  };
}

/** Snap every link onto its goal at rest (first frame, or after a gap). */
export function primeTailChain(s: TailChainState, goals: Float32Array): void {
  s.pos.set(goals);
  s.prev.set(goals);
  s.primed = true;
}

function relax(s: TailChainState, goals: Float32Array): void {
  // Hold each link at its goal's distance from the link before it, root out.
  const p = s.pos;
  for (let i = 1; i < TAIL_LINKS; i++) {
    const a = (i - 1) * 3;
    const b = i * 3;
    const rest = Math.hypot(
      goals[b] - goals[a],
      goals[b + 1] - goals[a + 1],
      goals[b + 2] - goals[a + 2],
    );
    const dx = p[b] - p[a];
    const dy = p[b + 1] - p[a + 1];
    const dz = p[b + 2] - p[a + 2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;
    const k = rest / len;
    p[b] = p[a] + dx * k;
    p[b + 1] = p[a + 1] + dy * k;
    p[b + 2] = p[a + 2] + dz * k;
  }
}

function substep(s: TailChainState, goals: Float32Array, dt: number, tune: TailChainTuning): void {
  const p = s.pos;
  const q = s.prev;
  const keep = tune.damping ** (dt * 60);
  const fall = tune.gravity * dt * dt;
  for (let i = 0; i < TAIL_LINKS; i++) {
    const o = i * 3;
    if (i === 0) {
      p[o] = q[o] = goals[o];
      p[o + 1] = q[o + 1] = goals[o + 1];
      p[o + 2] = q[o + 2] = goals[o + 2];
      continue;
    }
    const u = i / (TAIL_LINKS - 1);
    const stiff = tune.stiffRoot + (tune.stiffTip - tune.stiffRoot) * u;
    const pull = 1 - Math.exp(-stiff * dt);
    for (let k = 0; k < 3; k++) {
      const vel = (p[o + k] - q[o + k]) * keep;
      q[o + k] = p[o + k];
      p[o + k] += vel + (goals[o + k] - p[o + k]) * pull;
    }
    p[o + 1] -= fall;
  }
  relax(s, goals);
}

/** Advance the chain by dt seconds toward this frame's goals (TAIL_LINKS world
 *  points, xyz interleaved). An unprimed chain snaps onto them. */
export function stepTailChain(
  s: TailChainState,
  goals: Float32Array,
  dt: number,
  tune: TailChainTuning = TAIL_TUNING,
): void {
  if (!s.primed) {
    primeTailChain(s, goals);
    return;
  }
  let left = Math.max(0, dt);
  while (left > 1e-6) {
    const h = Math.min(left, MAX_STEP_S);
    substep(s, goals, h, tune);
    left -= h;
  }
}
