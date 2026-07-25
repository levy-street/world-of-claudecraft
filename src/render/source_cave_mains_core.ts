// Pure per-frame state for The Open Source's mains-to-backup lighting: the
// server hall runs lit until the reboot button is pressed, then drops to a
// torch-carried gloom. Three-free and deterministic, so the easing and the
// blend are testable without a renderer.
//
// Two independent eases. `mix` is WHERE the viewer is: it rises while they
// stand in the cave band and falls back outside, so a real delve keeps the
// plain shared baseline. `power` is WHAT the button did: it falls fast and
// recovers slowly, so the cut reads as a breaker snapping rather than a dimmer.

export interface SourceCaveMainsState {
  mix: number;
  power: number;
}

/** The shared delve ambience this blend departs from and returns to. */
export interface SourceCaveMainsAnchors {
  hemi: number;
  env: number;
  fogFar: number;
}

export interface SourceCaveMainsLevels {
  /** 0 outside the cave, 1 fully inside; also the fog-colour blend weight. */
  mix: number;
  /** 1 on mains, 0 on backup; also the lit-vs-dark fog-colour weight. */
  power: number;
  hemi: number;
  env: number;
  fogFar: number;
}

const MAINS_HEMI = 0.85;
const BACKUP_HEMI = 0.1;
const MAINS_ENV = 0.35;
const BACKUP_ENV = 0.02;
const MAINS_FOG_FAR = 200;
const BACKUP_FOG_FAR = 58;

/** Fog tints the painter lerps between; hex here, THREE.Color at the call site. */
export const SOURCE_CAVE_MAINS_FOG_COLOR = 0x2a241c;
export const SOURCE_CAVE_BACKUP_FOG_COLOR = 0x070302;

const POWER_FALL_RATE = 9;
const POWER_RISE_RATE = 2.2;
const MIX_RATE = 3;
/** Under this the blend is indistinguishable from the plain delve baseline. */
const MIX_EPSILON = 0.01;

export function createSourceCaveMainsState(): SourceCaveMainsState {
  return { mix: 0, power: 1 };
}

function ease(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

// base is the shared ambience; the cave's own lit and dark ends are picked by
// `power`, then the whole departure is scaled by how far into the cave we are.
function blend(base: number, backup: number, mains: number, power: number, mix: number): number {
  return base + (backup + (mains - backup) * power - base) * mix;
}

/**
 * Advance one frame. Returns the levels to apply, or null once the viewer is
 * outside and the blend has faded out, meaning the frame writes nothing and the
 * shared ambience owns the scene again.
 */
export function stepSourceCaveMains(
  state: SourceCaveMainsState,
  input: { inCave: boolean; powered: boolean; dt: number },
  anchors: SourceCaveMainsAnchors,
): SourceCaveMainsLevels | null {
  const { inCave, powered, dt } = input;
  if (!inCave && state.mix < MIX_EPSILON) {
    state.mix = 0;
    state.power = 1;
    return null;
  }
  // Power only tracks while inside: outside, the last state is held so walking
  // back into a rebooted hall does not flash the lights on first.
  if (inCave) {
    const rate = powered ? POWER_RISE_RATE : POWER_FALL_RATE;
    state.power = ease(state.power, powered ? 1 : 0, rate, dt);
  }
  state.mix = ease(state.mix, inCave ? 1 : 0, MIX_RATE, dt);

  const { mix, power } = state;
  return {
    mix,
    power,
    hemi: blend(anchors.hemi, BACKUP_HEMI, MAINS_HEMI, power, mix),
    env: blend(anchors.env, BACKUP_ENV, MAINS_ENV, power, mix),
    fogFar: blend(anchors.fogFar, BACKUP_FOG_FAR, MAINS_FOG_FAR, power, mix),
  };
}
